# Runbook — Clerk production cutover (CLERK-7)

Big-bang cutover from local email/password auth to Clerk, using a dedicated
**production** Clerk instance separate from the **development** instance already
used in the app. Existing users are imported into Clerk ahead of time and
re-authenticate once, with their existing credentials, on the new app build.

- **Spec:** CLERK-7 (Linear STA-11 / Notion CLERK-7)
- **Depends on:** CLERK-4 (mobile auth), CLERK-5 (social login), CLERK-6 (drop
  identity columns) — all landed on `feat/clerk-auth-migration`.
- **Audience:** the operator running the cutover (needs Clerk, Railway, EAS,
  App Store Connect, and DNS access).

> [!IMPORTANT]
> **CLERK-6 is the point of no return.** That migration drops
> `passwordHash`, `email`, `firstName`, `lastName` from `User` and makes
> `clerkUserId` required. Once it applies in production, the API can no longer
> serve the old local-auth code path, so "roll back to pre-Clerk auth" is not a
> code revert — it requires a database restore. Take a fresh DB backup
> immediately before the migration runs (see [Rollback](#rollback)).

---

## The two-instance model

| | Development instance | Production instance |
|---|---|---|
| Publishable key | `pk_test_…` | `pk_live_…` |
| Secret key | `sk_test_…` | `sk_live_…` |
| Mobile (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`) | `.env.local` (dev builds) | EAS env var, `production` environment |
| API (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) | `apps/api/.env` | Railway dashboard secrets |
| Sending domain | Clerk shared dev domain | DNS-verified custom domain |

Key hygiene rules:

- The **secret key never ships client-side.** The mobile app only ever reads
  the publishable key (`apps/mobile/lib/clerk.ts`); nothing in `apps/mobile`
  reads `CLERK_SECRET_KEY`. Keep it that way — the secret key lives only in
  Railway and on the operator machine that runs the import.
- Publishable keys are client-safe by design, but the **production** key is
  still injected via the EAS `production` environment rather than committed, so
  dev builds can't accidentally point at the prod instance.

---

## One-time production setup

Do all of this **before** cutover day. None of it affects live users on its own.

### 1. Create the production Clerk instance

1. Clerk Dashboard → create/enable the **Production** instance for the app.
2. Copy the production API keys (`pk_live_…`, `sk_live_…`). You'll place them in
   Railway and EAS below.

### 2. Verify the sending domain (DNS)

Production Clerk will not send auth/reset emails from a real address until the
domain is DNS-verified.

1. Clerk Dashboard (prod) → **Domains** / **Emails** → add the sending domain.
2. Add the DNS records Clerk shows (CNAME/TXT for the mail subdomain + DKIM) at
   the DNS provider.
3. Wait for propagation, then confirm every record reads **Verified** in Clerk.
4. Sanity check: trigger a password-reset email to yourself and confirm it
   arrives from the verified domain.

### 3. Configure the session token (custom claims)

The API reads `email`, `first_name`, and `last_name` from the session JWT
(`apps/api/src/middlewares/auth.middleware.ts`). These are **not** in the
default token.

1. Clerk Dashboard (prod) → **Sessions** → **Customize session token**.
2. Add to the claims:
   ```json
   {
     "email": "{{user.primary_email_address}}",
     "first_name": "{{user.first_name}}",
     "last_name": "{{user.last_name}}"
   }
   ```
3. Mirror whatever the dev instance already has so behaviour matches.

### 4. Configure social providers (Google + Apple)

CLERK-5 ships Google and Apple sign-in. The dev instance uses Clerk's shared
credentials; **production requires your own OAuth credentials.**

1. Clerk Dashboard (prod) → **SSO connections** → enable Google and Apple.
2. Provide production OAuth client IDs/secrets (Google Cloud console; Apple
   Developer → Sign in with Apple) and register Clerk's prod redirect URLs.

### 5. Stage the API secrets in Railway

Add to the Railway service (do **not** deploy yet — just set the variables):

- `CLERK_PUBLISHABLE_KEY` = `pk_live_…`
- `CLERK_SECRET_KEY` = `sk_live_…`

### 6. Create the mobile publishable key in EAS

The `production` build profile is configured to pull env vars from the EAS
`production` environment (`apps/mobile/eas.json`). Create the key there:

```bash
cd apps/mobile
eas env:create --environment production \
  --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY \
  --value pk_live_… \
  --visibility plaintext
```

(Publishable keys are client-safe, so `plaintext` visibility is fine — it is
baked into the bundle regardless.)

---

## Cutover ordering (and why)

The three moving parts are the **user import**, the **API deploy**, and the
**mobile release**. Constraints that fix the order:

- After CLERK-6, the deployed API validates **only** Clerk tokens. The moment
  the prod API flips to Clerk, every old app install (local-JWT auth) stops
  working — so the new app build must be **available to release the same day**.
- App Store review takes hours-to-days, so the build must be **submitted and
  approved in advance** and held, then released to coincide with the API flip.
- Users can only sign in after their accounts exist in prod Clerk, so the
  **import runs before** the API flip.

**Order:**

1. Build + submit the mobile app; get it **approved** and held (not released).
2. Take a production **DB backup**.
3. Run the **user import** against prod Clerk.
4. **Deploy the API** with prod Clerk keys (this is the flip).
5. **Release** the approved mobile build.
6. **Verify** (checklist below).

---

## Cutover steps

### Step 1 — Build and submit the mobile app (days ahead)

```bash
cd apps/mobile
eas build -p ios --profile production --auto-submit
```

- The build injects `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (prod) from the EAS
  `production` environment and `EXPO_PUBLIC_API_URL` from `eas.json`.
- In App Store Connect, take the build through review but **do not release** it
  yet — hold it for a manual release in Step 6.

### Step 2 — Back up the production database

Take a fresh snapshot/backup of the Railway Postgres database and confirm it's
restorable. This is the rollback anchor for the CLERK-6 migration.

### Step 3 — Import existing users into prod Clerk

Run the import (CLERK-3 script) pointed at the **production** instance. Run it
from a trusted operator machine, never from CI or a client:

```bash
cd apps/api
CLERK_SECRET_KEY=sk_live_… \
DATABASE_URL=<prod-db-url> \
  npx tsx scripts/import-users-to-clerk.ts
```

- The script refuses to run against the test/dummy secret key and is idempotent
  (matches on `externalId` + email), so it is safe to re-run if it's
  interrupted.
- Confirm the user count in the Clerk prod dashboard matches the DB.

### Step 4 — Deploy the API (the flip)

Merge `feat/clerk-auth-migration` into `main`. Railway auto-deploys on push to
`main`; the start command runs `prisma migrate deploy` (applying the CLERK-6
migration) before booting.

- Confirm Railway picked up `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` (prod).
- Health check: `curl https://starlightapi-production.up.railway.app/health`.

### Step 5 — Release the mobile build

Release the held, approved build in App Store Connect. Existing users update the
app and sign in once with their existing credentials.

### Step 6 — Verify

Run the [post-cutover verification](#post-cutover-verification) checklist.

---

## Rollback

Rollback difficulty depends on whether Step 4's migration has applied.

**Before Step 4 (migration not yet applied):** low risk. Nothing user-facing
changed — the old app + old API are still live. Abort by not merging; remove the
staged Railway/EAS values if you want a clean slate. Imported Clerk users are
harmless (idempotent, re-usable next attempt).

**After Step 4 (migration applied):** the identity columns are gone, so the API
cannot revert to local auth by a code rollback alone. To fully roll back:

1. Restore the production database from the Step 2 backup.
2. Redeploy the previous (pre-Clerk) API commit to `main`.
3. Keep the old app build as the released version (do not release Step 5's
   build), or release a hotfix pointing back at local auth.

Because true rollback is expensive, prefer **roll-forward**: most post-flip
failures (missing claim, unset key, unverified domain, social redirect) are
fixed in the Clerk dashboard or Railway env without a redeploy. Reserve the DB
restore for a genuine data-integrity failure in the import/migration.

---

## Post-cutover verification

Maps to the CLERK-7 acceptance criteria:

- [ ] **Existing user, one re-auth:** update the app, sign in with existing
      email + password, land in the app with data intact.
- [ ] **New sign-up:** a brand-new user can register and reach onboarding.
- [ ] **Password reset:** request a reset, receive the email from the
      DNS-verified domain, complete it, and sign in with the new password.
- [ ] **Social login:** Google and Apple sign-in complete against the prod
      instance.
- [ ] **API auth:** authenticated API calls succeed (JWT verified against prod
      JWKS); `req.auth` resolves `email` / `first_name` / `last_name`.
- [ ] **Key hygiene:** the mobile bundle contains only the publishable key; the
      secret key is present only in Railway.
