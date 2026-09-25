# Runbook — Clerk production cutover (CLERK-7)

**Status:** In progress · **Owner:** Navdeep Beniwal · **Cutover:** 2026-09 · **Spec:** CLERK-7 (Linear STA-11)

Big-bang cutover from local email/password auth to a dedicated **production** Clerk
instance. Existing users are imported into Clerk with their bcrypt hashes preserved
*before* the flip, then re-authenticate once — with their current credentials — on
the new build. Builds on CLERK-3→6, all shipping in **PR #14**.

Infrastructure, the dev/prod two-instance key model, and secret-key hygiene are
documented in the [README](../../README.md) — this runbook covers the cutover only
and does not repeat them.

> [!IMPORTANT]
> **`drop_user_identity_columns` is the point of no return.** It deletes
> `passwordHash`, `email`, `firstName`, `lastName` and makes `clerkUserId`
> required. Once it applies in prod, the API can no longer serve the old
> local-auth path — rollback becomes a **database restore, not a code revert**.
> Take a fresh, restorable backup immediately before it runs (Step 2).

## Preconditions

Nothing starts until all are true:

- [ ] One-time prod setup complete (§One-time production setup)
- [ ] PR #14 (`sta-11-clerk-7-production-cutover` → `main`) reviewed and mergeable
- [ ] Prod Clerk `pk_live_`/`sk_live_` keys staged in Railway (API) and EAS (mobile)
- [ ] A demo account exists in **prod** Clerk (needed for Beta App Review, Step 6)
- [ ] Operator has access: Clerk, Railway, EAS, App Store Connect, DNS

## One-time production setup

Done once, ahead of cutover; none of it affects live users.

1. **Create the prod Clerk instance.** A production instance requires an
   **application domain you own and control DNS for** — this holds even for a
   mobile-only app, because Clerk hosts the prod Frontend API at `clerk.<domain>`.
   Starlight uses `trystarlight.app`. It cannot be the Railway URL (no DNS control
   there).
2. **Verify DNS.** Add the CNAMEs Clerk lists — Frontend API (`clerk`), Account
   portal (`accounts`), and email (`clkmail` + two `clk*._domainkey` DKIM) — at the
   registrar and confirm all verified. Clerk auto-serves the Apple
   domain-association file, so no file hosting is required.
3. **Social providers** (production needs your **own** OAuth credentials — Clerk's
   shared dev credentials are dev-only):
   - **Google:** a **Web application** OAuth client; authorized redirect
     `https://clerk.<domain>/v1/oauth_callback`.
   - **Apple:** this app uses Clerk's **browser OAuth flow** (`startSSOFlow`), not
     native Sign in with Apple — so configure a **Services ID** (web), a Sign-in
     key (`.p8` + Key ID), and Team ID, with `clerk.<domain>` as the domain and the
     same return URL. The App ID needs Sign in with Apple enabled *only* to serve as
     the Services ID's Primary App ID (see the capability-sync note in Step 1).
4. **Stage keys.** `pk_live_`/`sk_live_` in Railway; `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`
   in the EAS `production` environment (publishable key only — the secret never
   ships client-side).

## Cutover sequence

Each step lists its command, how to verify, and how to back out.

### Step 1 — Build → TestFlight

```bash
cd apps/mobile
npm run build:prod:ios   # EXPO_NO_CAPABILITY_SYNC=1 eas build -p ios --profile production --auto-submit
```

- **Why `EXPO_NO_CAPABILITY_SYNC=1`:** the App ID has Sign in with Apple enabled
  (to back the Clerk Services ID), but the binary declares no native Apple
  entitlement. EAS's auto capability-sync sees the mismatch and tries to *disable*
  the capability on the App ID — which Apple rejects, aborting the build. The flag
  stops EAS touching the App ID. Sync runs on the **local CLI**, so the flag must be
  a local env var (it has no effect inside `eas.json`'s build `env`).
- The build injects `pk_live_` (EAS env) and the prod `EXPO_PUBLIC_API_URL`
  (`eas.json`).
- **Verify:** binary uploads to App Store Connect and appears under TestFlight
  (Processing → ready).
- **Rollback:** none — a build harms nothing until testers install it.

### Step 2 — Back up the prod database

Take a fresh Railway Postgres snapshot and confirm it restores. This is the only
rollback anchor for Step 5's drop.

- **Verify:** backup listed and confirmed restorable.

### Step 3 — Apply the pre-drop migrations

Prod has three pending migrations; the last is the point of no return. The import
(Step 4) must run **after** `add_clerk_user_id` (so `clerkUserId` exists to write)
but **before** `drop_user_identity_columns` (so `email`/`passwordHash` still exist
to read). So apply everything *except* the drop:

```bash
cd apps/api
# Stash the drop so `migrate deploy` stops after add_clerk_user_id
mv prisma/migrations/20260919120000_drop_user_identity_columns /tmp/clerk-drop-migration
DATABASE_URL="<prod-railway-db-url>" npx prisma migrate deploy
```

- **Verify:** `migrate deploy` reports applying `relax_user_identity_nullable` and
  `add_clerk_user_id`; the `clerkUserId` column now exists (identity columns still
  present).
- **Rollback:** these migrations are additive/reversible — no restore needed if
  aborting here.

### Step 4 — Import users → prod Clerk

```bash
cd apps/api
CLERK_SECRET_KEY="sk_live_…" DATABASE_URL="<prod-railway-db-url>" \
  npx tsx scripts/import-users-to-clerk.ts
# Restore the drop so merging PR #14 applies it
mv /tmp/clerk-drop-migration prisma/migrations/20260919120000_drop_user_identity_columns
```

- Must be the `sk_live_` **prod** key — an `sk_test_` passes the script's guard but
  imports into the *dev* instance. The script is idempotent (matches on `externalId`
  + email), so it is safe to re-run.
- Don't skip the restore. Safety net: the drop is committed on the branch, so
  `git checkout apps/api/prisma/migrations` (from repo root) brings it back.
- **Verify:** the script's linked count ≈ DB user count, and the Clerk prod
  dashboard user count matches.

### Step 5 — Flip (deploy the API)

Merge **PR #14** into `main`. Railway auto-deploys; the start command runs
`prisma migrate deploy` (now applying only the drop) before booting on the
`pk_live_`/`sk_live_` keys.

> The flip is **PR #14 / `sta-11-clerk-7-production-cutover`** — the full reviewed
> stack. *Not* `feat/clerk-auth-migration`, which is stale (missing CLERK-6/7).

```bash
gh pr merge 14 --squash
curl https://starlightapi-production.up.railway.app/health
```

- **Verify:** health OK, and an authenticated request with a Clerk session
  succeeds (JWKS-verified, resolves to the local user via the `clerkUserId` anchor).
- **Rollback:** the drop has applied — restore the Step 2 backup and redeploy the
  pre-Clerk commit. Prefer roll-forward (see Rollback).

### Step 6 — Roll out to testers

Distribution is **TestFlight with external testers**, not a public App Store
release — so there is no "hold the approved build and release to coincide" step.

1. Once the Step 1 build is processed, add it to **Internal Testing** (no review)
   and install it. Internal skips Beta App Review, so you can validate the full flow
   against flipped prod before exposing anyone.
2. Run the Step 7 checklist on that internal build.
3. Submit the **same** build to **External Beta App Review**, with the prod-Clerk
   **demo account** credentials in the review notes (Apple requires a working login
   for a gated app).
4. On approval, notify external testers to update — one re-auth with their existing
   email + password.

- **Unavoidable window:** external testers on the old build get 401s from the flip
  until they update — big-bang has no dual-auth window by design. Keep the group
  informed.

### Step 7 — Verify

- [ ] **Existing user:** update app, sign in with existing email+password, data intact.
- [ ] **New sign-up** reaches onboarding.
- [ ] **Password reset** email arrives from the DNS-verified domain and completes.
- [ ] **Social:** Google and Apple sign-in complete against the prod instance.
- [ ] **API auth:** authenticated calls succeed — JWKS-verified, resolved via the
      `clerkUserId` anchor (`apps/api/src/middlewares/auth.middleware.ts`).
- [ ] **Key hygiene:** the mobile bundle carries only the publishable key; the
      secret key is present only in Railway.
- [ ] **Post-cutover:** rotate any `sk_live_` / DB credentials handled on operator
      machines during the run.

## Rollback

- **Before Step 5 (drop not applied):** low risk — old app + old API are still
  live. Abort by not merging; Step 3's migrations are additive; imported Clerk users
  are harmless (idempotent, reusable on the next attempt).
- **After Step 5 (drop applied):** identity columns are gone, so there is no
  code-only revert. Restore the Step 2 backup, redeploy the pre-Clerk commit, and
  keep the old build as the released version. Because this is expensive, prefer
  **roll-forward**: most post-flip failures (missing claim, unset key, unverified
  domain, social redirect) are fixed in the Clerk dashboard or Railway env without a
  redeploy. Reserve the restore for genuine import/migration data corruption.

## Background

- **Why big-bang (no dual-auth window):** after CLERK-6 the API validates *only*
  Clerk tokens; there is deliberately no period accepting both local JWTs and Clerk
  tokens. Consequence: the new build must be installable at/before the flip, and old
  builds break until updated.
- **Two-instance key model and hygiene:** see the [README](../../README.md).
