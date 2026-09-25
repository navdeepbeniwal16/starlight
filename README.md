# Starlight

An AI-powered day planner that picks your most valuable tasks and time-boxes them around your routine.

<p align="center">
  <img src="docs/screenshots/demo.gif" width="280" alt="Starlight generating a day plan" />
</p>

You have more on your plate than any day can hold, and the tasks only keep piling up. Starlight helps you turn that scattered, endless list into a focused day — picking out the most valuable tasks and time-boxing them around your real routine, so you can focus your energy on doing work that matters.

<p align="center">
  <a href="https://testflight.apple.com/join/Gm1Mj39Y">
    <img src="https://img.shields.io/badge/TestFlight-Join%20the%20beta-0D96F6?style=for-the-badge&logo=apple" alt="Join the TestFlight beta" />
  </a>
</p>

## How it works

| 1. Sync your tasks | 2. Shape your day | 3. Review the plan | 4. Work your day |
|:---:|:---:|:---:|:---:|
| <img src="docs/screenshots/sync_tasks.PNG" width="190" alt="Task backlog before planning" /> | <img src="docs/screenshots/adjust_day.PNG" width="190" alt="Day template editor" /> | <img src="docs/screenshots/proposed_plan.PNG" width="190" alt="AI-proposed plan" /> | <img src="docs/screenshots/today_scheduled.PNG" width="190" alt="Today's confirmed schedule" /> |
| Start from your real backlog — add new tasks, tap to edit, swipe to complete or delete. | Set wake and sleep times and block out fixed routines to build a day outline. | Starlight picks your most urgent and valuable tasks and slots them into time blocks — rearrange anything, then confirm. | A clear, time-boxed schedule for today. Check tasks off or replan on the fly. |

## How it's built

Starlight is a solo project, built with an agentic workflow using Claude Code. While the implementation runs through the agent, I own the spec, architecture, code design, data model, and API contracts, backed with code reviews and a DB-backed test suite.

The agent works against a fixed setup:
- **`CLAUDE.md`** — the working agreement: the monorepo split (API/mobile contexts), where work is tracked, and how it's triaged.
- **`docs/agents/`** — the per-context docs the agent reads before it touches code.
- **Linear** (team STA) — where work is tracked; each ticket is specced before any code is written, then carried on its own branch.

Each ticket follows the same delivery loop:
- The ticket is specced first — problem, scope, acceptance criteria — and picked
  up once it's Ready and Unblocked.
- One Linear issue → one short-lived branch → one pull request, linked to the issue.
- Each PR is self-reviewed against the repo's standards and the ticket's spec before merge, and checked by CI on each push.
- Merges to `main` deploy the API automatically (Railway); the mobile app ships on demand via EAS.

## Architecture

Starlight is a TypeScript monorepo — an Expo / React Native app and an Express API in one repo, backed by PostgreSQL, with day-plan generation delegated to Claude.

### Stack

| Area | Technologies |
|---|---|
| Mobile | Expo (SDK 55), React Native, React 19, expo-router, TanStack Query, Zustand, Reanimated |
| Auth | Clerk — `@clerk/express` (API) + `@clerk/expo` (mobile); minimal-local user anchor with just-in-time provisioning |
| API | Node, Express 5, TypeScript (strict), zod, Helmet, pino (structured logs) |
| Data | PostgreSQL, Prisma 7 via `@prisma/adapter-pg` |
| AI | Anthropic Claude Opus 4.8 (`@anthropic-ai/sdk`) — tool-use output + adaptive thinking |
| Integrations | Resend (email), Expo Push (notifications) |
| Tooling & CI/CD | Turborepo + npm workspaces, GitHub Actions, Railway (API + Postgres), EAS (mobile) |

### System

```mermaid
flowchart LR
    subgraph mobile["Mobile · Expo / React Native"]
        direction TB
        ui["Presentation<br/>expo-router"]
        stores["Client state<br/>Zustand stores"]
        mauth["Auth session<br/>Clerk"]
        mclient["API client<br/>typed, bearer token"]
        ui <-->|"render / user actions"| stores
        stores <-->|"request / data"| mclient
        mauth -->|"session token"| mclient
    end

    subgraph api["API · Express 5 / TypeScript"]
        direction TB
        routes["Request routing<br/>Express"]
        authmw["Auth middleware<br/>Clerk session"]
        services["Domain services"]
        orm["Data access<br/>Prisma"]
        routes --> authmw --> services --> orm
    end

    clerk["Clerk"]
    anthropic["Claude Opus 4.8"]
    db[("PostgreSQL")]
    resend["Resend · email"]
    push["Expo Push"]

    mclient <-->|"REST request / JSON response"| routes
    mauth <-->|"sign in / session token"| clerk
    authmw <-->|"verify session token"| clerk
    orm <-->|"SQL read / write"| db
    services <-->|"tasks + blocks / proposed schedule"| anthropic
    services -->|"send email"| resend
    services -->|"send push"| push
```

A user signs into the mobile app through Clerk and receives a session token; the Zustand stores call the API over REST with that token. The API verifies the token in middleware (against Clerk), passes the request down through its domain services, and reads or writes Postgres via Prisma. Day-plan generation is delegated to Claude — the services send the day's tasks and blocks and get a proposed schedule back — while email and push notifications are one-way sends through Resend and Expo.

### How the planner works

Day-plan generation treats the model as an untrusted component: the model proposes task assignments, and deterministic code validates, bounds, and — where needed — evicts to fit, so a hallucinated or over-capacity response cannot produce an invalid plan.

```mermaid
sequenceDiagram
    autonumber
    participant M as Mobile
    participant A as API
    participant DB as Postgres
    participant P as planAgent
    participant AI as Claude Opus 4.8

    M->>A: POST /day-plan/generate (authenticated)
    A->>DB: load tasks, day template, planned blocks
    A->>P: build input — tasks nested by project
    loop bounded re-plan attempts
        P->>AI: messages + submit_schedule tool (adaptive thinking)
        AI-->>P: tool_use — proposed assignments
        P->>P: validate (zod), drop hallucinated ids, dedupe
        P->>P: check block capacity, feed overflow back
    end
    P->>P: capacity floor — evict to fit
    P-->>A: validated schedule
    A-->>M: proposed plan (persisted only on confirm)
```

### Data model

```mermaid
erDiagram
    User ||--o| DayTemplate : has
    User ||--o{ DayPlan : owns
    User ||--o{ Task : owns
    User ||--o{ Project : owns
    DayTemplate ||--o{ Block : contains
    DayPlan ||--o{ PlannedBlock : contains
    PlannedBlock ||--o{ Task : schedules
    Project ||--o{ Task : groups
```

A reusable **day template** (routine blocks) is projected into a dated **day plan** of **planned blocks**; the planner slots **tasks** into those blocks. **Projects** group tasks under a goal and can be marked in-focus to bias scheduling.

## Prerequisites

- **Node.js 22+** — the repo pins **26** via `.mise.toml`; with [mise](https://mise.jdx.dev) installed, `mise install` picks it up.
- **Docker** — for local PostgreSQL.
- **Xcode + iOS Simulator** — for the mobile app.
- **Service keys** — a [Clerk](https://clerk.com) dev instance (auth), an [Anthropic](https://console.anthropic.com) API key (day-plan generation), and a [Resend](https://resend.com) key (transactional email).

## Quick setup

```bash
# 1. Install dependencies (both workspaces)
npm install

# 2. Copy env files, then fill in the keys from the table below
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env.local
# In apps/api/.env, set DATABASE_URL to match the Docker credentials below:
#   postgresql://starlight:starlight@localhost:5432/starlight

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

The API runs on `http://localhost:3000`. The mobile app reads `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` from `apps/mobile/.env.local`.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | PostgreSQL connection string |
| `CLERK_PUBLISHABLE_KEY` | `apps/api/.env` | Clerk publishable key (dev: `pk_test_…`) |
| `CLERK_SECRET_KEY` | `apps/api/.env` | Clerk secret key (dev: `sk_test_…`) |
| `ANTHROPIC_API_KEY` | `apps/api/.env` | Anthropic key for day-plan generation |
| `RESEND_API_KEY` | `apps/api/.env` | Resend email API key |
| `RESEND_FROM_EMAIL` | `apps/api/.env` | Verified sending address |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` | API base URL for the mobile app |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/mobile/.env.local` | Clerk publishable key for the client |

`PORT` (default `3000`) and `NODE_ENV` are optional — see the `.env.example` files.

## Deployment

Backend and mobile ship **independently, on different triggers**. CI never deploys — it is only a quality gate.

### API — auto-deploys to Railway

- Hosted on Railway at `https://starlightapi-production.up.railway.app`; PostgreSQL is a Railway-managed database.
- Railway's GitHub integration watches `main`: **every push to `main` triggers a production deploy.** There is no Dockerfile — Railway's railpack builder auto-detects the app and `.mise.toml` pins Node 26 for the build.
- The start command applies migrations before booting, so a healthy server implies migrations ran: `prisma migrate deploy && node dist/index.js`.
- Deploy check: `curl https://starlightapi-production.up.railway.app/health`.
- Secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) live in the Railway dashboard, not in git. Production uses a **separate Clerk instance** from development (`pk_live_`/`sk_live_` vs `pk_test_`/`sk_test_`).

### Mobile — manual via EAS

- Built in the cloud by EAS and distributed through Apple TestFlight / the App Store (bundle `com.starlight.assistant`).
- No automatic trigger — a human runs the CLI from `apps/mobile`: `npm run build:prod:ios` (wraps `eas build -p ios --profile production --auto-submit`).
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
