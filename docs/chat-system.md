# Manycat agent chat — system description

**Date:** 2026-07-17  
**Code root:** `src/app/_fragments/chat/`  
**Related aspirational spec:** agent-chat interaction patterns (Downloads / planning docs)  
**This doc describes what is implemented today.** Prefer it over older specs where they conflict.

---

## 1. Product mental model

Manycat chat is **not** a symmetric messenger. It is an **agent workspace** with a chat timeline:

- The **thread is the agent’s canvas** — agent prose is unbound (no bubble chrome).
- The **user message is a recognizable ask** — user text stays in a bubble so “what I asked for” is scannable.
- **Work indicators are ephemeral** — they attach to the *current* run only, never archive as history spam.
- **Diffs are the unit of trust** — reviewable file cards; full review opens Monaco workspace.
- **Stop is always available** while working — square stop inside the composer.

Inspired by Cursor / Claude Code: calm “doing” line + optional thinking detail; no firehose of tool noise in the main thread.

---

## 2. Shell / navigation

Primary UI: `chat.tsx` (client).

**Rail (signed-in):**
- **New** → `view === "feed"` — landing composer (`projects.tsx`) to create a project from a prompt.
- **Projects** → `view === "chats"` — sidebar list of workflows/sessions + active chat. Header title: **Projects**.
- Other stubs: Deployments, Agents, Integrations, etc.

**Session model:**
- Each thread is a `Workflow` (`id`, `name`, `repo`, `status`, `messages`, `workspace`).
- `Project` is grouping/deploy config; chat threads remain workflow-shaped.
- On sign-in, `workflow.listSessions` hydrates the list. Local `initialWorkflows` is empty.

---

## 3. Domain types (`data.ts`)

### Workflow status
```ts
type WorkflowStatus = "idle" | "working" | "needs-review" | "done"
```

### Message union (`Msg`)
| Type | Role | In thread history |
|---|---|---|
| `text` | User (`me`) or agent prose | Yes |
| `agent-status` | Live “doing” + optional thinking | **Ephemeral** (reducer strips when not working) |
| `diff` | Per-file before/after + summary | Yes |
| `approval` | Approve / Request changes | Yes |
| `milestone` | Completion marker | Yes |

### `AgentStatusMsg`
```ts
{
  type: "agent-status"
  id: number
  time: string
  text: string
  action?: string      // chip verb, e.g. "building"
  path?: string        // chip shows basename
  thinking?: string    // expand behind chevron
  streaming?: boolean  // pulse + shimmer
}
```

---

## 4. Event stream (single reducer)

All agent side-effects go through `handleAgentEvent` in `chat.tsx`.

### `AgentEventPayload`
```ts
| { kind: "status"; status: WorkflowStatus }
| { kind: "append"; message: Msg }
| { kind: "upsert-status"; message: AgentStatusMsg }
| { kind: "patch-workspace"; path; contents; edited? }
| { kind: "resolve-approval"; messageId; resolved }
| { kind: "done" }
```

### Reducer ownership of the status invariant
**The reducer owns “no archived chips” as source of truth:**

- **`upsert-status`:** drop every existing `agent-status`, append the new one → exactly one live status in state.
- **`status` ≠ `"working"`:** strip all `agent-status` from `messages`.
- Render-layer filtering is defense-in-depth only; do not “fix” away the reducer strip.

### Hydration
Sessions that come back as `working` with **no attached event stream** are coerced to `idle` plus an “run was interrupted” agent text message. A refresh mid-run cannot resume a synchronous request/response agent call — leaving `working` would show a permanent live chip.

---

## 5. Rendering (`message-list.tsx`)

### Live chip vs thread
```
thread = messages without agent-status
liveStatus = last agent-status (if any)
showLive = liveStatus && (streaming || isWorking || isStopping)
```
At most one `LiveWorkingIndicator` at the **bottom** while a run is in flight / stopping.

### Text
- **User:** right-aligned bubble.
- **Agent:** unbound prose (no bubble). Chat is the agent’s space.

### Working card
Compact `w-fit` chip: `● building page.tsx ▸`  
Pulse + `.shimmer` while streaming. Click expands thinking (collapsed by default; auto-collapses on step change).

### Diff
`InlineDiffEditor` → click opens workspace Monaco diff. Do not invent a second diff UI.

---

## 6. Composer + Stop

Control lives **inside** the input (right):

| State | Control | Behavior |
|---|---|---|
| Idle / review / done | Send | `agent.run(text)` |
| Working | Stop (square) | Request cancel |
| Stopping (remote) | Stop disabled / “Stopping…” | **Send blocked** until in-flight mutation settles |

**Honest Stop semantics (critical):**

- **Mock:** cancel clears timers immediately → `idle`. Real stop.
- **Remote (today):** harness abort is **not** end-to-end. Stop must **not** pretend the sandbox stopped.
  - UI enters **Stopping…** (still locked).
  - When the in-flight `runAgent` mutation settles, discard its events, append a short “Stopped — previous run may have left partial workspace changes” note, then `idle`.
  - **Never** set `idle` and allow a new send while the previous mutation is still pending — that races two writers on one workspace.

Escape triggers the same cancel path. Full orchestrator/harness abort remains backlog.

---

## 7. Agent runners (`agent-sim.ts`)

`useAgent()`:
1. Mock if `NEXT_PUBLIC_MOCK_AGENT=1|true` or infra disabled.
2. Else remote (`workflow.runAgent`).

### Known footgun — dual run entry points
Historically, create-from-prompt called `runAgent` via a **separate** mutation in `chat.tsx`, bypassing `useAgent` (different mock-flag behavior). **Target:** one `run()` / one mutation ownership so mock vs remote is decided once. Until fully unified, Stop/busy state must cover every in-flight run path.

### Mock sequence
User text → `working` → timed `upsert-status` steps → workspace patch → diff → approval → `needs-review`.  
Default script edits `src/app/page.tsx` when no `agentScripts[id]`.

---

## 8. Design principles (do not regress)

1. Two channels: doing chip while running; thinking only on expand.
2. **Reducer** strips status when not working — chips never archive.
3. Exactly one live status row via upsert.
4. Agent unbound / user bubbled.
5. Chip is compact (`w-fit`), not full-width.
6. **Honest Stop** — no silent fake-idle while a remote run is still in flight.
7. Single event reducer — no parallel message state in random components.
8. Reuse `InlineDiffEditor`.

---

## 9. Known risks & backlog (ordered)

### P0 — correctness
1. **Honest remote Stop** — Stopping… + block send until mutation settles; discard late events. (E2E harness abort still open.)
2. **Interrupted hydration** — coerce orphaned `working` sessions to `idle` + notice.

### P1 — retention / architecture
3. **ActivityLog fold-in** — ephemerality discards “what did the agent do?” After a run, fold accumulated status steps into one collapsed `ActivityLogMsg` instead of deleting them. Same reducer, no firehose.
4. **Single run entry point** — create-from-prompt and composer both call the same `run()` so mock/remote/stop live in one place.

### P2 — spec remainder
| Item | Notes |
|---|---|
| Real `git diff` vs checkpoint | Partial |
| Structured `ErrorMsg` + Retry | Raw text errors still appear |
| Checkpoints / restore | Not done |
| PlanMsg | Not done |
| Per-file accept/reject | Not done |
| Edit & resend / superseded | Not done |

---

## 10. Key files

| File | Responsibility |
|---|---|
| `chat.tsx` | Shell, reducer, composer, stop, drawers, hydration |
| `message-list.tsx` | Thread render, WorkingCard, InlineDiffEditor |
| `data.ts` | Types, scripts |
| `agent-sim.ts` | `useAgent`, mock/remote, cancel honesty |
| `workspace.tsx` | Monaco |
| `projects.tsx` | New-project landing |
| `src/server/api/routers/workflow.ts` | tRPC + event payloads |
| `src/styles/globals.css` | `.shimmer` |

---

## 11. Local demo

- App: `http://localhost:3000` (worktrees on other ports may lag).
- `NEXT_PUBLIC_MOCK_AGENT=1` forces mock UI without a harness model key.
- Path: **Projects** → thread → send. Live chip only while working/stopping.

---

When changing this system: keep the reducer as the only mutation path, keep status ephemeral **and** plan ActivityLog retention, keep agent unbound, keep Stop honest, and prefer extending `Msg` / events over one-off UI state.
