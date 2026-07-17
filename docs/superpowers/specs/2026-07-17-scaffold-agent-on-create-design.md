# Scaffold-first agent generation on create

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Related:** `2026-07-17-nextjs-railway-neon-design.md`, chat workspace persistence

## Problem

`createFromPrompt` only writes a static Next.js App Router scaffold (prompt used as title/quote). The selected model (Modal / harness) runs only on a later chat `runAgent`. Users expect create to **generate the app on top of the Next base**, then keep editing via chat.

## Goals

1. After create, automatically run the agent against the scaffold with the user’s prompt and selected `model` / `effort`.
2. Scaffold + sandbox appear immediately; generation continues in the background while the user can browse files / preview.
3. Later chat turns keep editing the same tree via existing `runAgent`.
4. If agent/Modal is unavailable or fails: **keep the scaffold**, show a clear chat error, allow retry by sending a message.

## Non-goals

- Server-side durable job queue / survive tab close mid-run
- Auto Railway deploy after first generation
- New Modal wiring (reuse `AGENT_HARNESS_URL`, `OPENAI_BASE_URL`, model catalog)
- Replacing the Next scaffold with a different framework unless the user asks in a later turn

## Approach (chosen)

**Client chains create → `runAgent`.**

`createFromPrompt` stays scaffold-only (fast return). The chat UI then calls existing `runAgent` with the create prompt, selected model/effort, and scaffold files — same path as a normal send.

Rejected alternatives:

- **Server awaits agent inside create** — long HTTP, timeouts, harder streaming; tab-close resilience not required for v1
- **Orchestrator auto-bootstrap** — crosses planes, new APIs, awkward model/effort plumbing

## Flow

```text
User: create from prompt (+ model, effort)
  → createFromPrompt: scaffold Next + seed sandbox + persist
  → UI: show workspace (browsable), status working, agent-status message
  → UI: runAgent({ prompt, workflowId, model, effort, files })
  → harness: seed workspace, ReAct edit on top of Next tree, return files
  → UI: merge files/messages; status idle
  → On error: keep scaffold; append error; user can send to retry
```

Follow-up chat messages: unchanged `runAgent` on current workspace.

## API / UI changes

| Surface | Change |
|---------|--------|
| Create UI | Already passes `model` / `effort` into `handleCreateFromPrompt`; must set client state **and** use them on the chained `runAgent` (today they are stored but create does not start agent). |
| `createFromPrompt` | No harness call. Optional: accept `model`/`effort` only if we want them persisted for analytics — not required for v1. |
| After create success | Do **not** set status `idle` with “Virtual git ready…” as the final state. Keep `working`, append agent-status (“Building your app on the Next scaffold…”), invoke `agent.run` / `runAgent`. |
| Agent failure / harness off | Scaffold remains; chat error e.g. “Generation failed — send a message to retry.” If `workflow.isEnabled` is false, same messaging (no silent scaffold-only). |
| Tab close | Mid-run generation stops (accepted v1 tradeoff). |

## Agent prompt (first turn)

First chained turn should instruct the harness that:

- Workspace is an existing **Next.js App Router** project (keep `app/`, `package.json` build/start scripts, Railway-ready `next start` on `$PORT`).
- Implement the user’s product prompt **on top of** that base (pages, components, styles, deps as needed).
- Do not scrap the scaffold for a non-Next app unless explicitly asked.

Follow-up turns keep the existing “editing existing project” framing in the harness.

Implementation options (plan picks one):

1. Client prefixes/wraps the user prompt for the first `runAgent` only, or
2. Harness accepts `mode: "bootstrap"` / `context: "next-scaffold"` and builds the wrapper server-side.

Prefer (2) if small; (1) is fine for v1 to avoid harness deploy coupling.

## Infra

Unchanged prerequisites:

- `AGENT_HARNESS_URL` + `SANDBOX_ORCHESTRATOR_URL` for remote agent
- Modal: `OPENAI_BASE_URL` + model id (`auto` / `qwen-coder` / etc.) on the agent service
- Scaffold hardening for Railway (`next` ≥ patched, `npm` in `railway.toml`) remains as today

## Billing

Create already charges sandbox estimate. Chained `runAgent` uses existing agent billing/gates on `runAgent`. No new product meter for v1.

## Testing

- Unit/UI: after successful create mock, `runAgent` is invoked once with prompt + model + effort + scaffold files.
- When harness disabled: create still succeeds; error message appears; no throw that deletes project.
- Integration (mocked harness): returned files replace workspace; status returns to idle.
- Manual: create with Modal model selected → scaffold visible immediately → files update → preview reflects generation → second chat message continues editing.

## Success criteria

1. Create no longer ends on a static quote page as the “product.”
2. Selected model drives the first generation.
3. User can browse scaffold while generation runs.
4. Failure leaves a usable Next project + clear retry path.
