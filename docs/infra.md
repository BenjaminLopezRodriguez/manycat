# manycat infrastructure

Run manycat with Docker Compose locally, or on a local Kubernetes cluster (kind) using the same service topology.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- For Kubernetes: [kind](https://kind.sigs.k8s.io/), kubectl
- Optional: LLM API key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) for the programming agent
- Optional: Modal open-weight coder — see [infra/modal/README.md](../infra/modal/README.md)

## Architecture

| Service | Port | Role |
|---------|------|------|
| `app` | 3000 | Next.js UI + tRPC |
| `postgres` | 5432 | Database |
| `agent` | 8000 | LangChain programming agent (FastAPI) |
| `orchestrator` | 8080 | Spins up per-workflow sandbox containers |
| sandbox containers | 4000–4999 | Isolated dev environments with preview URLs |

## Docker Compose (recommended first)

```bash
cp .env.example .env
# Add OPENAI_API_KEY if using the real agent

pnpm docker:up      # builds sandbox image + compose stack
pnpm docker:logs    # tail logs
pnpm docker:down    # stop stack
```

Open http://localhost:3000. When `AGENT_HARNESS_URL` and `SANDBOX_ORCHESTRATOR_URL` are set (Compose sets these automatically), chat workflows use the real agent and show a **sandbox preview** link in the thread header.

Without those env vars, `pnpm dev` continues to use the mock agent.

### Manual sandbox image build

```bash
pnpm docker:sandbox-image
```

## Local Kubernetes (kind)

```bash
pnpm k8s:cluster   # create kind cluster, build/load images, apply manifests
pnpm k8s:delete    # remove k8s resources
pnpm k8s:down      # delete kind cluster
```

- App: http://localhost:3000 (NodePort 30000)
- Orchestrator: http://localhost:8080 (NodePort 30080)

The orchestrator mounts the host Docker socket (dev only) to create sandbox containers, mirroring Compose behavior. Production should use the Kubernetes Job API with RBAC (see `k8s/base/rbac-orchestrator.yaml` and `sandbox-job-template` ConfigMap).

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string |
| `AGENT_HARNESS_URL` | e.g. `http://agent:8000` in Compose |
| `SANDBOX_ORCHESTRATOR_URL` | e.g. `http://orchestrator:8080` |
| `MODEL` | LLM id for agent-harness (`openai:coder` for Modal) |
| `OPENAI_API_KEY` | OpenAI key, or any string when using Modal stub |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL (Modal vLLM `…/v1`) |

## Production notes

- See [planes.md](./planes.md) for control vs workload isolation and [railway-control.md](./railway-control.md) for deploying orchestrator/agent to Railway.
- Replace in-cluster Postgres with managed database (Neon, RDS).
- Push images to a container registry; update `image:` fields in `k8s/base/`.
- Do not mount `docker.sock` in production — extend orchestrator to create `Job` resources from `k8s/base/sandbox-job-template.yaml`, or use Railway Sandboxes in the workload plane.
- Add an Ingress controller (nginx) for HTTPS and preview path routing.
- Set `RAILWAY_API_TOKEN` + `RAILWAY_WORKLOAD_*` on the Manycat app (Vercel) for account-scoped live deploys.
