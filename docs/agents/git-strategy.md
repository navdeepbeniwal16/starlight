# Git & Release Strategy

## Branches

- **`main`** — production. Railway auto-deploys the API on merge. Protected: PR + green CI only, no direct pushes.
- **`develop`** — integration. Deploys nowhere. Work accumulates here.
- **Feature branches** — one ticket → one branch → merges into `develop`. No epic branches. (Naming: see `issue-tracker.md`.)

## Merge & history

- **feature → `develop`: squash** (one conventional commit per ticket).
- **`develop` → `main`: merge commit (`--no-ff`)**. Never squash this seam.
- Tag each `main` merge / draft a GitHub Release. Tags don't trigger deploys.

## Releasing an epic

Merge a **`develop → main` PR**. This:
1. Deploys the API (Railway).
2. Needs the mobile build cut: `eas build … --auto-submit` (apps/mobile) → TestFlight → App Store / Play Store.
3. Needs a tag / GitHub Release.

## Deploy targets

- **API** — Railway, auto-deploys `main`; start command runs `prisma migrate deploy`. Secrets in Railway dashboard.
- **Mobile** — Expo EAS → TestFlight → stores, triggered manually per release.
- **No staging.** CI (typecheck + tests + `prisma migrate deploy`) validates every PR.

## Don't

- Don't `reset`/rebase `develop` onto `main` — it's ahead by unreleased work that would be lost.
- Don't create epic/long-lived feature branches.
- Don't use feature flags for normal epics — only to expose partial work inside an already-shipped build.
