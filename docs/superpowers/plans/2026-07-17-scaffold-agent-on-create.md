# Scaffold-First Agent on Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `createFromPrompt` returns the Next scaffold, the client immediately starts `runAgent` with the selected model/effort so Modal/harness builds the app on top of that base while the user can browse files.

**Architecture:** Keep `createFromPrompt` scaffold-only. Add a pure `wrapNextScaffoldBootstrapPrompt` helper. Extend `runAgent` with `omitUserMessage` so the create chat does not duplicate the user prompt. Wire `handleCreateFromPrompt` to set workspace to `working`, then `runAgent.mutateAsync` with scaffold files + bootstrap-wrapped prompt (or surface a clear error if infra is off).

**Tech Stack:** Next.js 15 / tRPC / React / Vitest / existing agent-harness HTTP `/run`

## Global Constraints

- Client chains create → `runAgent` (no server-side job queue; tab close stops mid-run — accepted).
- Scaffold must remain on agent failure; error copy must allow retry via normal send.
- First turn must instruct: implement on existing Next App Router scaffold; do not scrap for a non-Next app unless asked.
- Do not change Modal wiring; reuse `AGENT_HARNESS_URL`, model catalog, existing `runAgent` billing.
- v1 uses **client-side prompt wrap** (spec option 1) — no harness deploy required.

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/bootstrap-prompt.ts` | Pure wrapper text for first-turn Next scaffold generation |
| `src/lib/bootstrap-prompt.test.ts` | Unit tests for wrapper |
| `src/server/api/routers/workflow.ts` | `runAgent` input: optional `omitUserMessage` |
| `src/app/_fragments/chat/chat.tsx` | Chain create → `runAgent` after scaffold; fail-soft messaging |

---

### Task 1: Bootstrap prompt helper

**Files:**
- Create: `src/lib/bootstrap-prompt.ts`
- Create: `src/lib/bootstrap-prompt.test.ts`

**Interfaces:**
- Produces: `wrapNextScaffoldBootstrapPrompt(userPrompt: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { wrapNextScaffoldBootstrapPrompt } from "./bootstrap-prompt";

describe("wrapNextScaffoldBootstrapPrompt", () => {
  it("embeds the user prompt and Next scaffold instructions", () => {
    const out = wrapNextScaffoldBootstrapPrompt("build a todo app with dark mode");
    expect(out).toContain("build a todo app with dark mode");
    expect(out).toMatch(/Next\.js App Router/i);
    expect(out).toMatch(/do not replace|do not scrap|keep the existing/i);
    expect(out).toMatch(/package\.json|next start|PORT/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/bootstrap-prompt.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
/** First-turn prompt: generate product UI on the existing Next scaffold. */
export function wrapNextScaffoldBootstrapPrompt(userPrompt: string): string {
  const prompt = userPrompt.trim();
  return [
    "You are editing an existing Next.js App Router project already in the workspace.",
    "Keep the App Router layout (`app/`), TypeScript, and package.json scripts that build and run with `next start` on `$PORT` (Railway-ready).",
    "Implement the user's product request on top of this scaffold: add/edit pages, components, styles, and dependencies as needed.",
    "Do not replace the project with a non-Next stack unless the user explicitly asks.",
    "Use tools to edit files; then briefly summarize what you built.",
    "",
    "User request:",
    prompt,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/bootstrap-prompt.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/bootstrap-prompt.ts src/lib/bootstrap-prompt.test.ts
git commit -m "Add Next scaffold bootstrap prompt wrapper for create→agent."
```

---

### Task 2: `runAgent` omitUserMessage

**Files:**
- Modify: `src/server/api/routers/workflow.ts` (`runAgent` input + message append logic)

**Interfaces:**
- Consumes: existing `runAgent` mutation
- Produces: `omitUserMessage?: boolean` on input — when true, do not push a new `from: "me"` message (create already inserted the user prompt); still run harness with `prompt` (bootstrap-wrapped)

- [ ] **Step 1: Locate current input schema and user message append**

In `workflow.ts` `runAgent`, the input zod object and the block that builds `userMsg` / `events.push({ kind: "append", message: userMsg })`.

- [ ] **Step 2: Extend input schema**

Add to the `runAgent` input:

```ts
omitUserMessage: z.boolean().optional(),
```

- [ ] **Step 3: Conditionally skip user message in events + persistence**

When `input.omitUserMessage` is true:

- Do **not** append `userMsg` to `events`
- Do **not** include `userMsg` in `appendWorkflowMessages` arrays on success/failure
- Still send `prompt: input.prompt` to the harness `/run` body unchanged
- Still append `agent-status` and result messages

When false/undefined: keep current behavior (append user message).

- [ ] **Step 4: Manual sanity via existing chat**

Send a normal chat message (omitUserMessage unset) — user bubble still appears once.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routers/workflow.ts
git commit -m "Allow runAgent to omit duplicate user message for bootstrap."
```

---

### Task 3: Wire create → runAgent in chat UI

**Files:**
- Modify: `src/app/_fragments/chat/chat.tsx` (`handleCreateFromPrompt`)

**Interfaces:**
- Consumes: `wrapNextScaffoldBootstrapPrompt`, `api.workflow.runAgent`, `api.workflow.isEnabled`
- Produces: after create success, chained generation with model/effort from create opts

- [ ] **Step 1: Add runAgent mutation + isEnabled query near createFromPrompt**

In `chat.tsx` where hooks are declared (alongside `createFromPrompt`):

```ts
const runAgentMutation = api.workflow.runAgent.useMutation({
  onSuccess: (data) => {
    for (const event of data.events) {
      handleAgentEvent(event);
    }
    if (data.previewUrl) setPreviewUrl(data.previewUrl);
  },
  onError: (err) => {
    // Fail-soft: scaffold already in state; surface error on active workflow
    handleAgentEvent({
      kind: "append",
      message: {
        id: Date.now(),
        type: "text",
        from: "agent",
        text: `Generation failed — send a message to retry. (${err.message})`,
        time: nowTime(),
      },
    });
    handleAgentEvent({ kind: "status", status: "idle" });
  },
});
const { data: infra } = api.workflow.isEnabled.useQuery();
```

Ensure `handleAgentEvent` is stable / declared before these hooks, or use refs if needed to avoid TDZ — match existing `useAgent` pattern (`onEventRef`) if hook order requires it.

- [ ] **Step 2: After successful create, keep `working` and show bootstrap status**

Replace the post-create `status: "idle"` success branch so that:

```ts
status: "working",
workspace: data.files,
messages: [
  {
    id: 1,
    type: "text",
    from: "me",
    text: promptText,
    time: nowTime(),
  },
  {
    id: 2,
    type: "text",
    from: "agent",
    text: data.previewUrl
      ? `Scaffold ready (${data.contentRootHash.slice(0, 8)}…). Preview at ${data.previewUrl}`
      : `Scaffold ready (${data.contentRootHash.slice(0, 8)}…). Building your app on the Next scaffold…`,
    time: nowTime(),
  },
  {
    id: 3,
    type: "agent-status",
    text: "Building your app on the Next scaffold…",
    streaming: true,
    time: nowTime(),
  },
],
```

Call `setActiveId(data.workflowId)` **before** starting `runAgent` so `handleAgentEvent` patches the correct workflow.

- [ ] **Step 3: Chain runAgent or fail-soft if infra disabled**

Immediately after updating workflow state with scaffold files:

```ts
const model = opts?.model ?? aiModel;
const effort = opts?.effort ?? aiEffort;

if (!infra?.enabled) {
  // Keep scaffold; clear streaming status; tell user how to retry
  setWorkflows((prev) =>
    prev.map((w) =>
      w.id === data.workflowId
        ? {
            ...w,
            status: "idle",
            messages: [
              ...w.messages.filter((m) => m.type !== "agent-status"),
              {
                id: Date.now(),
                type: "text",
                from: "agent",
                text: "Generation failed — agent not configured. Send a message to retry once AGENT_HARNESS_URL and SANDBOX_ORCHESTRATOR_URL are set.",
                time: nowTime(),
              },
            ],
          }
        : w,
    ),
  );
} else {
  void runAgentMutation.mutateAsync({
    workflowId: data.workflowId,
    prompt: wrapNextScaffoldBootstrapPrompt(promptText),
    messageIdStart: 3,
    model,
    effort,
    files: data.files.map((f) => ({ path: f.path, contents: f.contents })),
    omitUserMessage: true,
  });
}
```

Import `wrapNextScaffoldBootstrapPrompt` from `@/lib/bootstrap-prompt`.

- [ ] **Step 4: Avoid double user bubbles**

Confirm create path does not also call `agent.run(promptText)` which would re-append the user message. Only `runAgentMutation` with `omitUserMessage: true`.

- [ ] **Step 5: Commit**

```bash
git add src/app/_fragments/chat/chat.tsx
git commit -m "Chain createFromPrompt into runAgent with Next bootstrap prompt."
```

---

### Task 4: Verify fail-soft + follow-up chat

**Files:**
- Modify only if bugs found: `chat.tsx` / `workflow.ts`

**Interfaces:**
- Consumes: Tasks 1–3

- [ ] **Step 1: Harness-off path**

With infra disabled (or mock `isEnabled` false locally): create from prompt → scaffold files visible → error message present → status idle → sending a chat message still works (mock or remote when enabled).

- [ ] **Step 2: Harness-on happy path (manual)**

1. Ensure agent-harness + orchestrator up; Modal model selected (e.g. `qwen-coder` / `auto`).
2. Create from prompt: “Build a simple habit tracker with three habits.”
3. Expect: scaffold files appear immediately; status working; agent-status streaming.
4. Expect: workspace updates; preview changes; status idle.
5. Send “Add a fourth habit for reading” → second `runAgent` edits same tree (no bootstrap wrap).

- [ ] **Step 3: Commit only if fixes landed**

```bash
git add -u
git commit -m "Fix create→agent edge cases from manual verification."
```

(Skip commit if nothing changed.)

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Auto run agent after create with model/effort | 3 |
| Scaffold immediate; gen in background | 3 (create returns first; mutateAsync not awaited before UI update) |
| Later chat edits same tree | 3 + existing `send` → `agent.run` |
| Fail soft + clear retry | 3 (infra off + mutation onError) |
| Next scaffold first-turn instructions | 1 + 3 wrap |
| No duplicate user message | 2 |
| No server job queue / no Modal rewire | Global — not in tasks |

## Placeholder scan

None. Helper lives in `src/lib/bootstrap-prompt.ts` for safe client + server import.
