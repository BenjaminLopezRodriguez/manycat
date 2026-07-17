# Next.js Railway auto-deploy + Neon app data

**Date:** 2026-07-17  
**Status:** Approved (design conversation); awaiting implementation plan  
**Scope:** Full loop — Next template, GitHub mirror, Railway Next build/start, plan-gated Neon

## Problem

Local prompt → sandbox works, but Railway “Run” is GitHub-repo-only with no Next.js template and no per-app database. Free users should share Neon with schema isolation; paying users (`sub` / `metered`) get a dedicated Neon project. Control-plane Neon must never be injected into workloads.

## Goals

1. Auto-run Next.js on Railway like Vercel (detect/build/start on `$PORT`).
2. Persist Manycat control metadata in existing Neon (`DATABASE_URL`).
3. Give each deployed app a Postgres target:
   - **free:** shared Neon DB, **schema-per-app**
   - **paying:** dedicated Neon project; connection injected into Railway only
4. Deploy prompt/virtual apps by mirroring the tree to a Manycat-owned GitHub org, then Railway `source.repo`.

## Non-goals (v1)

- BYO Neon / user-pasted connection strings (seam only).
- Migrating free shared schema → dedicated on upgrade (leave old schema; provision dedicated on next Run).
- Docker-image deploy path (alternative rejected).
- Railway Functions (Bun single-file) — use existing GraphQL workload **services**.

## Architecture

```
Control (Vercel Manycat)
  ├─ manycat_* on control Neon (DATABASE_URL)
  ├─ GitHub mirror (GITHUB_MIRROR_ORG)
  └─ Neon provisioner (shared | dedicated)

Workload (Railway mc-{account}-{workflow})
  └─ Next.js: pnpm build / pnpm start -p $PORT
       └─ DATABASE_URL → shared schema search_path | dedicated project
```

**Hard rules**

- Never put control `DATABASE_URL`, Auth secrets, or Railway control tokens into user services.
- Workload services stay in `RAILWAY_WORKLOAD_*` only (`docs/planes.md`).
- Service name remains `mc-{account}-{workflow}`.

## Components

| Piece | Path / responsibility |
|-------|------------------------|
| Next scaffold | `src/server/content/scaffold-next.ts` — `templateId: "next-app"` |
| Existing scaffold | Keep calculator/static for non-Next; prompt create defaults to Next |
| GitHub mirror | `src/server/github/mirror.ts` — create/update repo, push tree |
| Neon provision | `src/server/neon/provision.ts` — plan gate + idempotent ensure |
| Railway client | Extend `createWorkloadService` / deploy: Next build/start + app DB vars |
| `project.run` | Mirror if needed → Neon → Railway → persist metadata |
| UI | Deployments: enable Run for virtual; show DB mode + URL + budget |

## Data model

Extend `manycat_project`:

| Column | Type | Notes |
|--------|------|--------|
| `mirrorGithubRepo` | varchar | `org/repo` Manycat mirrors to |
| `neonMode` | `"shared" \| "dedicated"` | from billing plan at provision time |
| `neonSchema` | varchar | e.g. `app_{sanitizedWorkflowId}` (shared) |
| `neonProjectId` | varchar | dedicated Neon project id |
| `neonDatabaseUrlEnc` | text | encrypted workload URL at rest (optional if dedicated URL fetched on demand via Neon API) |

Billing mapping:

- `free` → `neonMode: "shared"`
- `sub` \| `metered` → `neonMode: "dedicated"`

Control tables (`accounts`, `projects`, `project_changes`) continue to use control `DATABASE_URL` only.

## Env (control plane)

| Variable | Purpose |
|----------|---------|
| `GITHUB_MIRROR_TOKEN` | PAT/App token with repo create + contents |
| `GITHUB_MIRROR_ORG` | e.g. `manycat-apps` |
| `NEON_API_KEY` | Neon management API |
| `NEON_ORG_ID` | Org for dedicated project creates |
| `NEON_SHARED_PROJECT_ID` | Free-tier parent project |
| `NEON_SHARED_DATABASE_URL` | Free shared DB (≠ control `DATABASE_URL`) |
| `APP_DB_ENCRYPTION_KEY` | Encrypt dedicated URLs at rest (recommended) |

Existing: `DATABASE_URL`, `RAILWAY_API_TOKEN`, `RAILWAY_WORKLOAD_PROJECT_ID`, `RAILWAY_WORKLOAD_ENVIRONMENT_ID`.

## Next.js template (Vercel-like)

Scaffold includes at minimum:

- `package.json` — `next`, `react`, `react-dom`; scripts `dev`, `build`, `start` (`next start -H 0.0.0.0 -p ${PORT:-3000}`)
- `app/page.tsx`, `app/layout.tsx`, `next.config.ts`, `tsconfig.json`
- Root `railway.toml` (or Nixpacks env): build `pnpm build` / `npm run build`, start production server on `$PORT`
- Optional stub that reads `process.env.DATABASE_URL` so the injected DB is usable

Sandbox local preview continues via orchestrator (`pnpm dev`); Railway uses production build.

## Deploy flow (`project.run` kind `railway`)

1. `assertCanSpend` (existing).
2. Resolve source tree (sandbox / content hash files).
3. If virtual / no user `githubRepo`: `mirror.ensureRepo` → set `mirrorGithubRepo`; deploy source = mirror. Else use user’s `githubRepo`.
4. Ensure Next-capable config on service (build/start); if tree is Next template, skip rewriting user repos that already define scripts.
5. `neon.ensureForProject(account, workflow, plan)`:
   - shared: `CREATE SCHEMA IF NOT EXISTS app_…`; return shared URL + `PGOPTIONS`/`search_path`
   - dedicated: create Neon project if missing; fetch connection URI
6. `deployProjectToRailway` with variables: `PORT`, `MANYCAT_*`, **workload** `DATABASE_URL`, and for shared `PGOPTIONS=-c search_path=app_…,public`.
7. Persist railway + neon + mirror fields on `manycat_project`.

**Idempotency:** reuse `mirrorGithubRepo`, `neonSchema` / `neonProjectId`, `railwayServiceId` on re-run; redeploy only.

## Errors

| Case | Behavior |
|------|----------|
| Mirror not configured | Fail before Neon/Railway with clear message |
| Mirror push fails | Abort; sandbox preview unchanged |
| Neon provision fails | Abort; no Railway with wrong DB |
| Dedicated Neon fails | Fail loud — **no** silent fallback to shared |
| Railway fails after Neon | Keep neon metadata; retry reuses |
| Budget exceeded | Existing gate |

## UX

- Prompt create → default `templateId: "next-app"`.
- Deployments: Run enabled for virtual projects.
- Success: live URL, badge `Shared schema` | `Dedicated Neon`, remaining budget.
- Free: short note that DB is schema-isolated on shared Postgres; upgrade for dedicated.

## Testing

- Unit: schema name sanitize; plan → mode; scaffold has build/start/`railway.toml`.
- Integration (mocked APIs): injected vars never equal control `DATABASE_URL`.
- Manual: free Run → schema exists; paying Run → new Neon project; re-run idempotent.

## Open seams (later)

- BYO `DATABASE_URL` for paying accounts.
- Schema → dedicated migration on upgrade.
- Poll Railway deployment ready before returning URL.
- Encrypt-at-rest mandatory if storing connection strings in Postgres.
