# Next.js Railway auto-deploy + Neon app data

**Date:** 2026-07-17  
**Status:** Approved; plan at `docs/superpowers/plans/2026-07-17-nextjs-railway-neon.md`  
**Scope:** Full loop — Next template, GitHub mirror, Railway Next build/start, plan-gated Neon

## Problem

Local prompt → sandbox works, but Railway “Run” is GitHub-repo-only with no Next.js template and no per-app database. Free users should share Neon with **role + schema** isolation; paying users (`sub` / `metered`) get a dedicated Neon project. Control-plane Neon must never be injected into workloads.

## Goals

1. Auto-run Next.js on Railway like Vercel (detect/build/start on `$PORT`).
2. Persist Manycat control metadata in existing Neon (`DATABASE_URL`).
3. Give each deployed app a Postgres target:
   - **free:** shared Neon DB, **schema-per-app + role-per-app** (grants are the boundary; `search_path` is convenience only)
   - **paying:** dedicated Neon project; connection URI fetched on demand from Neon API and injected into Railway only (not stored at rest)
4. Deploy prompt/virtual apps by mirroring the tree to a Manycat-owned GitHub org, then Railway `source.repo`.

## Non-goals (v1)

- BYO Neon / user-pasted connection strings (seam only).
- Migrating free shared schema → dedicated on upgrade (leave old schema; provision dedicated on next Run).
- Docker-image deploy path (alternative rejected).
- Railway Functions (Bun single-file) — use existing GraphQL workload **services**.
- Storing encrypted dedicated connection strings in Postgres (`neonDatabaseUrlEnc` — rejected; fetch on demand).

## Architecture

```
Control (Vercel Manycat)
  ├─ manycat_* on control Neon (DATABASE_URL)
  ├─ GitHub mirror (GITHUB_MIRROR_ORG, org-scoped token only)
  └─ Neon provisioner (shared role+schema | dedicated project)

Workload (Railway mc-{account}-{workflow})
  └─ Next.js: pnpm build / pnpm start -p $PORT
       └─ DATABASE_URL → per-app role URL (free) | dedicated project URI (paying)
```

**Hard rules**

- Never put control `DATABASE_URL`, Auth secrets, or Railway control tokens into user services.
- Workload services stay in `RAILWAY_WORKLOAD_*` only (`docs/planes.md`).
- Service name remains `mc-{account}-{workflow}`.
- **Fail loud — no silent dedicated→shared fallback.** If dedicated Neon provision fails for a paying account, abort the deploy. Do not “gracefully” fall back to the shared pool.
- **`search_path` is not isolation.** Free-tier apps must never receive the shared owner/`NEON_SHARED_DATABASE_URL` credentials. Each app gets its own `LOGIN` role with grants only on its schema.

## Components

| Piece | Path / responsibility |
|-------|------------------------|
| Next scaffold | `src/server/content/scaffold-next.ts` — `templateId: "next-app"` |
| Existing scaffold | Keep calculator/static for non-Next; prompt create defaults to Next |
| GitHub mirror | `src/server/github/mirror.ts` — create/update repo, push tree |
| Neon provision | `src/server/neon/provision.ts` — plan gate + idempotent ensure; **role+schema for shared** |
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
| `neonRole` | varchar | e.g. `app_{sanitizedWorkflowId}_role` (shared); password stored only as needed to build URL at inject time (see below) |
| `neonProjectId` | varchar | dedicated Neon project id (paying) |

**Do not store** `neonDatabaseUrlEnc` or any dedicated connection string at rest. For dedicated mode, persist `neonProjectId` only and call Neon `GET …/connection_uri` at deploy/inject time.

For shared mode, the per-app role password must be recoverable to build the workload `DATABASE_URL`. Prefer Neon/API or control-only secret store keyed by `(accountId, workflowId)` — not the owner shared URL. If a password must live in control DB, encrypt it under `APP_DB_ENCRYPTION_KEY` as `neonRolePasswordEnc` (role credential only, not a project-owner URI).

Billing mapping:

- `free` → `neonMode: "shared"`
- `sub` \| `metered` → `neonMode: "dedicated"`

Control tables (`accounts`, `projects`, `project_changes`) continue to use control `DATABASE_URL` only.

## Env (control plane)

| Variable | Purpose |
|----------|---------|
| `GITHUB_MIRROR_TOKEN` | **GitHub App installation token or fine-grained PAT scoped to `GITHUB_MIRROR_ORG` only** — never a classic PAT on a personal account. This token pushes user-generated code; blast radius must not include personal repos. |
| `GITHUB_MIRROR_ORG` | e.g. `manycat-apps` |
| `NEON_API_KEY` | Neon management API (create projects, fetch connection URIs) |
| `NEON_ORG_ID` | Org for dedicated project creates |
| `NEON_SHARED_PROJECT_ID` | Free-tier parent project |
| `NEON_SHARED_DATABASE_URL` | **Admin/owner** URL for the free shared DB — used **only** by control-plane `provision.ts` to `CREATE ROLE` / `CREATE SCHEMA` / `GRANT`. Never injected into Railway. (≠ control `DATABASE_URL`) |
| `APP_DB_ENCRYPTION_KEY` | Optional; only if encrypting shared role passwords at rest |

Existing: `DATABASE_URL`, `RAILWAY_API_TOKEN`, `RAILWAY_WORKLOAD_PROJECT_ID`, `RAILWAY_WORKLOAD_ENVIRONMENT_ID`.

## Next.js template (Vercel-like)

Scaffold includes at minimum:

- `package.json` — `next`, `react`, `react-dom`; scripts `dev`, `build`, `start` (`next start -H 0.0.0.0 -p ${PORT:-3000}`)
- `app/page.tsx`, `app/layout.tsx`, `next.config.ts`, `tsconfig.json`
- Root `railway.toml` (or Nixpacks env): build `pnpm build` / `npm run build`, start production server on `$PORT`
- Optional stub that reads `process.env.DATABASE_URL` so the injected DB is usable

Sandbox local preview continues via orchestrator (`pnpm dev`); Railway uses production build.

## Shared Neon provisioning (security-critical)

### One-time shared-DB setup (idempotent, not per-app)

Run once against the free shared database (migration/bootstrap, or `ensureSharedDbHardened()` gated by a control flag / advisory lock):

- `REVOKE ALL ON SCHEMA public FROM PUBLIC` — database-wide; affects every tenant and existing objects. **Do not** run this on every per-app provision (Nth vs N+1 race / redundant work). Idempotent re-run of setup is fine.
- Any other shared-DB hardening that is global (not tenant-scoped) lives here.

### Per-app provision (`neon/provision.ts`, `neonMode: "shared"`)

1. Connect with **admin** `NEON_SHARED_DATABASE_URL` (control only).
2. `CREATE SCHEMA IF NOT EXISTS app_{id}`.
3. `CREATE ROLE app_{id}_role LOGIN PASSWORD '<random>'` (or rotate idempotently if role exists and password is known).
4. `GRANT USAGE, CREATE ON SCHEMA app_{id} TO app_{id}_role`.
5. Ensure the app role can use objects it will create. **Do not** rely on `ALTER DEFAULT PRIVILEGES` run as admin for the app’s future tables — default privileges only apply to objects created by the role that ran that statement. The app role creates (and therefore owns) its own tables in its schema; that ownership is the grant that matters. Admin provisioning must **not** create tables/objects in `app_{id}` that the app role cannot touch. If admin must seed objects, `GRANT` them explicitly to `app_{id}_role` (and prefer letting the app migrate itself instead).
6. Ensure role has **no** `CREATE` on `public` and **no** access to other `app_*` schemas (role has no grants there; do not re-run global `REVOKE … FROM PUBLIC` here).
7. Build workload `DATABASE_URL` with **that role’s** credentials (host/db from shared, user=`app_{id}_role`). Optionally set `search_path=app_{id},public` as convenience — **grants are the wall**.
8. Persist `neonSchema`, `neonRole` (+ encrypted password if needed). Never return or inject the admin URL.

**Why:** User apps run arbitrary code. `search_path` alone lets any free tenant `SELECT * FROM app_someone_else.users` with the shared owner credential. Role grants are the actual isolation boundary.

## Deploy flow (`project.run` kind `railway`)

1. `assertCanSpend` (existing).
2. Resolve source tree (sandbox / content hash files).
3. If virtual / no user `githubRepo`: `mirror.ensureRepo` → set `mirrorGithubRepo`; deploy source = mirror. Else use user’s `githubRepo`.
4. Ensure Next-capable config on service (build/start); if tree is Next template, skip rewriting user repos that already define scripts.
5. `neon.ensureForProject(account, workflow, plan)`:
   - shared: role + schema as above; return **role** connection URL
   - dedicated: create Neon project if missing; **fetch connection URI on demand** via Neon API (do not persist the URI)
6. `deployProjectToRailway` with variables: `PORT`, `MANYCAT_*`, **workload** `DATABASE_URL` (role URL or dedicated URI). Never `NEON_SHARED_DATABASE_URL` / control `DATABASE_URL`.
7. Persist railway + neon metadata (`neonMode`, `neonSchema`, `neonRole`, `neonProjectId`, mirror, service ids) — not dedicated URLs.

**Idempotency:** reuse `mirrorGithubRepo`, `neonSchema` / `neonRole` / `neonProjectId`, `railwayServiceId` on re-run; redeploy only; re-fetch dedicated URI on each inject.

## Errors

| Case | Behavior |
|------|----------|
| Mirror not configured | Fail before Neon/Railway with clear message |
| Mirror push fails | Abort; sandbox preview unchanged |
| Neon provision fails | Abort; no Railway with wrong DB |
| Dedicated Neon fails | **Fail loud — no silent fallback to shared** |
| Railway fails after Neon | Keep neon metadata; retry reuses |
| Budget exceeded | Existing gate |

Implementation tickets must keep these exact fail-loud rules. Do not add “graceful” dedicated→shared fallbacks.

## UX

- Prompt create → default `templateId: "next-app"`.
- Deployments: Run enabled for virtual projects.
- Success: live URL, badge `Shared schema` | `Dedicated Neon`, remaining budget.
- Free: short note that DB is isolated via per-app Postgres role on shared Postgres; upgrade for dedicated.

## Testing

- Unit: schema/role name sanitize; plan → mode; scaffold has build/start/`railway.toml`.
- Integration (mocked APIs): injected vars never equal control `DATABASE_URL` or `NEON_SHARED_DATABASE_URL`.
- **Tenant isolation (required):** connect as app A’s role, attempt `SELECT` from app B’s schema, expect **permission denied**. This test is the free-tier security story.
- **App-owned objects (required):** after provision, connect as the app role, `CREATE TABLE` in its schema, read/write that table successfully. Do **not** only test tables created by the admin during setup.
- Manual: free Run → schema+role exist; paying Run → new Neon project; re-run idempotent; dedicated failure does not create shared resources; shared-DB `REVOKE … PUBLIC` is one-time setup, not per provision.

## Open seams (later)

- BYO `DATABASE_URL` for paying accounts.
- Schema → dedicated migration on upgrade.
- Poll Railway deployment ready before returning URL.
- Audit script extension: `G. tenant isolation` — assert per-role provisioning pattern + cross-schema permission-denied test exists.
