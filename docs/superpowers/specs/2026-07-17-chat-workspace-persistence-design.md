# Chat + workspace persistence (control Neon)

## Problem

Virtual workflows and chat messages lived only in React state, so refresh wiped them. Project rows already existed in Neon (`manycat_project`).

## Design

Persist per-account workflow UI state in the control Neon database (same `DATABASE_URL`):

| Table | Role |
|-------|------|
| `manycat_workflow_message` | Ordered chat messages (`payload` JSON) |
| `manycat_workspace_file` | Workspace file snapshot (path + contents) |

Also store `status` on `manycat_project` (optional column) or derive from last message — use a `status` varchar on project for restore.

## Write paths

- `createFromPrompt` — insert project (existing) + initial messages + scaffold files
- `runAgent` — append user/agent/approval messages; replace workspace files after agent returns
- Import path — optional later; github imports can start empty messages

## Read path

- `workflow.listSessions` (protected) — all projects for account with messages + files
- Chat UI hydrates `workflows` / `projects` when session is authenticated

## Non-goals

- S3 content-addressed store
- Realtime multi-tab sync
- Storing secrets in chat payloads
