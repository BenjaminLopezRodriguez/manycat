# Control plane vs workload plane

Manycat never mixes product infrastructure with user-generated compute or code.

| Plane | Railway project | Contents |
|-------|-----------------|----------|
| **Control** | `manycat-control` (`RAILWAY_CONTROL_PROJECT_ID`) | Orchestrator, agent-harness, (optional) control Redis/Postgres ops |
| **Workload** | `manycat-workloads` (`RAILWAY_WORKLOAD_PROJECT_ID`) | Per-account preview services, future sandboxes |

## Rules

1. User preview services are created only via the GraphQL API into the **workload** project.
2. Service names are `mc-{account}-{workflow}` and carry env tags `MANYCAT_ACCOUNT_ID`, `MANYCAT_WORKFLOW_ID`, `MANYCAT_PLANE=workload`.
3. Never inject `RAILWAY_API_TOKEN`, `AUTH_*`, `DATABASE_URL`, or Vercel tokens into user services.
4. Orchestrator and agent deploy only to the **control** project.
5. Manycat on Vercel talks to control services over HTTPS (`SANDBOX_ORCHESTRATOR_URL`, `AGENT_HARNESS_URL`).

## Account + budget

- Every project row is owned by `accountId`.
- Default plan `free` = **$5** hard cap; `sub` = **$30**; `metered` = PAYG past $5.
- Spin-up always requests minimal replicas/resources and is gated by budget.

## Local vs production

| Mode | Orchestrator | Workspaces |
|------|--------------|------------|
| Local Compose | dockerode + host docker.sock | `.sandbox-workspaces/` (gitignored) |
| Production | Control Railway service | Workload plane only — no control-plane Docker socket |

See [infra.md](./infra.md) for Compose/kind topology and [railway-control.md](./railway-control.md) for deploying control services.
