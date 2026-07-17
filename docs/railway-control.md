# Deploy control-plane services to Railway

Target Railway project: **manycat-control** (`RAILWAY_CONTROL_PROJECT_ID`).
Do **not** put user preview apps in this project.

## Prerequisites

- Railway CLI authenticated (`railway login`)
- Two Railway projects created: `manycat-control` and `manycat-workloads`
- Postgres for Manycat app (existing `DATABASE_URL` on Vercel)

## Services to deploy (control only)

### 1. sandbox-orchestrator

```bash
cd infra/sandbox-orchestrator
railway link   # select manycat-control
railway up
```

Suggested variables on the control service:

```
PORT=8080
WORKSPACE_ROOT=/workspaces
# Production: do not mount host docker.sock.
# Prefer Railway Sandboxes SDK (Phase 3) or a dedicated workload Docker host.
SANDBOX_IMAGE=manycat-sandbox:latest
PREVIEW_HOST=localhost
```

Public URL → set on Vercel as `SANDBOX_ORCHESTRATOR_URL`.

### 2. agent-harness

Deploy `agent-harness/` the same way into **manycat-control**.

```
AGENT_HARNESS_URL=https://<agent-service>.up.railway.app
```

## Workload project (ops notes)

Create empty project `manycat-workloads`. Copy:

- `RAILWAY_WORKLOAD_PROJECT_ID`
- `RAILWAY_WORKLOAD_ENVIRONMENT_ID` (usually `production`)
- Account/workspace `RAILWAY_API_TOKEN` (server-only on Manycat / Vercel)

Manycat GraphQL client creates `mc-*` services **only** in this project.

### GitHub mirror access (required for virtual/prompt deploys)

Virtual apps are mirrored to private repos under `GITHUB_MIRROR_ORG` (e.g. `manycat-apps`). Railway deploys those repos via **its** GitHub App — not Manycat’s mirror token.

1. Org owner: install **Railway** on `manycat-apps` at https://github.com/organizations/manycat-apps/settings/installations
2. Repository access: **All repositories** (mirrors are created dynamically; selected-repos will break new deploys)
3. In Railway account integrations, confirm GitHub is linked to a user who can see that org

Without this, `serviceCreate` fails with “Repository … not found or is not accessible” even though the mirror exists.

## Isolation checklist

- [ ] Control project has orchestrator + agent only
- [ ] Workload project has no Manycat app source
- [ ] Vercel env has workload IDs + token; token never in user service env
- [ ] `docs/planes.md` reviewed by anyone adding infra
