# Starlight

AI-powered personal day planning app.

## Stack

| Layer | Choice |
|---|---|
| Backend | TypeScript, Express, tRPC |
| Database | PostgreSQL, Prisma |
| Mobile | React Native, Expo |
| AI | Anthropic Claude APIs |
| Infra | AWS EC2, RDS, GitHub Actions |

## Prerequisites

- Node.js 20+
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
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` | API base URL for the mobile app |

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
