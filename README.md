# Starlight

AI-powered personal day planning app.

## Stack

| Layer | Choice |
|---|---|
| Backend | TypeScript, Express, REST |
| Database | PostgreSQL, Prisma |
| Mobile | React Native, Expo |
| AI | Anthropic Claude APIs |
| Infra | Railway (API + Postgres), EAS + App Store (iOS), GitHub Actions (CI) |

## Prerequisites

- Node.js 22+ (CI and production builds pin Node 26 via `.mise.toml`)
- Docker (for local PostgreSQL)
- Xcode + iOS Simulator (for mobile development)

## Quick setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp apps/api/.env.example apps/api/.env

# 3. Start the database
docker run --name starlight-db \
  -e POSTGRES_USER=starlight \
  -e POSTGRES_PASSWORD=starlight \
  -e POSTGRES_DB=starlight \
  -p 5432:5432 -d postgres:latest

# 4. Run migrations and seed
cd apps/api
npx prisma migrate dev
npm run db:seed
npx prisma generate
```

## Running locally

Three terminals:

```bash
# Terminal 1 — database (subsequent runs)
docker start starlight-db

# Terminal 2 — API
cd apps/api && npm run dev

# Terminal 3 — mobile
cd apps/mobile && npx expo start --clear
# Press i to open iOS simulator
```

The API runs on `http://localhost:3000`. The mobile app connects to it via `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local`.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | PostgreSQL connection string |
| `JWT_SECRET` | `apps/api/.env` | Secret for signing JWTs |
| `ANTHROPIC_API_KEY` | `apps/api/.env` | Anthropic API key |
| `RESEND_API_KEY` | `apps/api/.env` | Resend email API key |
| `RESEND_FROM_EMAIL` | `apps/api/.env` | Verified sending address |
| `CLERK_PUBLISHABLE_KEY` | `apps/api/.env` | Clerk publishable key (server-side token verification) |
| `CLERK_SECRET_KEY` | `apps/api/.env` | Clerk secret key — server-side only, never bundled in the app |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` | API base URL for the mobile app |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/mobile/.env.local` | Clerk publishable key for the mobile app (client-safe) |

## Deployment

Backend and mobile ship **independently, on different triggers**. CI never deploys — it is only a quality gate.

### API — auto-deploys to Railway

- Hosted on Railway at `https://starlightapi-production.up.railway.app`; PostgreSQL is a Railway-managed database.
- Railway's GitHub integration watches `main`: **every push to `main` triggers a production deploy.** There is no Dockerfile — Railway's railpack builder auto-detects the app and `.mise.toml` pins Node 26 for the build.
- The start command applies migrations before booting, so a healthy server implies migrations ran: `prisma migrate deploy && node dist/index.js`.
- Deploy check: `curl https://starlightapi-production.up.railway.app/health`.
- Secrets (`DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) live in the Railway dashboard, not in git. Production uses a **separate Clerk instance** from development (`pk_live_`/`sk_live_` vs `pk_test_`/`sk_test_`).

### Mobile — manual via EAS

- Built in the cloud by EAS and distributed through Apple TestFlight / the App Store (bundle `com.starlight.assistant`).
- No automatic trigger — a human runs the CLI from `apps/mobile`: `eas build -p ios --profile production --auto-submit`.
- The `production` profile (`apps/mobile/eas.json`) bakes `EXPO_PUBLIC_API_URL` (the Railway API) in at build time and lets EAS own the build number (`appVersionSource: remote`, `autoIncrement`). It pulls `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the `pk_live_` key) from the EAS `production` environment, so the prod key is never committed.
- `ios/` is gitignored (Continuous Native Generation) — EAS runs `expo prebuild` from `app.json` + `assets/` on each build.

### CI — quality gate only

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`: it spins up a Postgres service, runs `prisma migrate deploy`, then `turbo run type-check` and `turbo run test`. It does not deploy.

> For a change spanning both: deploy the API first (merge to `main`), then build the app — the app's baked-in API URL expects the new backend to already be live.

For the one-time Clerk production cutover (prod instance, DNS, secret placement, user import, ordering, and rollback), follow [`docs/runbooks/clerk-production-cutover.md`](docs/runbooks/clerk-production-cutover.md).

## Scripts

```bash
npm run type-check        # Type-check all workspaces
npm run test              # Run tests
npm run build             # Build all workspaces

cd apps/api
npm run db:migrate        # Run pending migrations
npm run db:seed           # Seed the database
npm run db:studio         # Open Prisma Studio
```
