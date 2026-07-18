# Integrations Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace account-menu Connect GitHub with always-visible Integrations that opens a searchable grid sheet; GitHub connects as today; request-integration emails via Resend when configured.

**Architecture:** Keep sheet state in `chat.tsx`. Extend `IntegrationsSheet` to a grid + in-sheet request form. Add pure server helpers for rate-limit + Resend send (TDD), expose `api.integration.request` via protectedProcedure, wire menu/drawer `onOpenIntegrations`.

**Tech Stack:** Next.js 15 / React 19 / tRPC 11 / Zod / Vitest / Resend / existing Sheet + Input + Button / Hugeicons

**Spec:** `docs/superpowers/specs/2026-07-17-integrations-catalog-design.md`

## Global Constraints

- Signed-in account menu always shows **Integrations** (never gate on `hasGitHub`).
- No **Connect GitHub** row in desktop or mobile account menus.
- Request UX stays **in the sheet** — no new route / Build-mode banner page.
- Only live connector in v1: GitHub via `signIn("github", { callbackUrl: "/" })`.
- Resend env optional; missing config → clear error, never fake success.
- Request form: name (required), note (optional), contact email (optional, prefill session email).
- Do not commit secrets; document env in `.env.example` only.

---

## File map

| File | Responsibility |
|------|----------------|
| `package.json` | Add `resend` dependency |
| `src/env.js`, `.env.example` | `RESEND_API_KEY`, `RESEND_FROM`, `INTEGRATION_REQUEST_TO` (optional) |
| `src/server/integrations/rate-limit.ts` | In-memory per-user 30s throttle |
| `src/server/integrations/rate-limit.test.ts` | Throttle tests |
| `src/server/integrations/request-email.ts` | Build subject/body; send via Resend |
| `src/server/integrations/request-email.test.ts` | Body + missing-config + send path |
| `src/server/api/routers/integration.ts` | `request` protected mutation |
| `src/server/api/root.ts` | Register `integration` router |
| `src/app/_fragments/chat/integrations-sheet.tsx` | Catalog, search, grid, request panel |
| `src/app/_fragments/chat/shell-mode-menu.tsx` | Integrations item + `onOpenIntegrations` |
| `src/app/_fragments/chat/chat.tsx` | Pass open handler; session email into sheet |

---

### Task 1: Env, Resend package, rate-limit + email helpers

**Files:**
- Modify: `package.json` (via `pnpm add`)
- Modify: `src/env.js`
- Modify: `.env.example`
- Create: `src/server/integrations/rate-limit.ts`
- Create: `src/server/integrations/rate-limit.test.ts`
- Create: `src/server/integrations/request-email.ts`
- Create: `src/server/integrations/request-email.test.ts`

**Interfaces:**
- Produces:
  - `assertNotRateLimited(userKey: string, now?: number): void` — throws `Error` with message `Please wait before requesting again` when within 30s
  - `markRateLimited(userKey: string, now?: number): void`
  - `_resetRateLimitForTests(): void`
  - `type IntegrationRequestPayload = { name: string; note?: string; contactEmail?: string; userId: string; userLabel: string; sessionEmail?: string | null }`
  - `type SendIntegrationRequestDeps = { apiKey?: string; from?: string; to?: string; sendEmail?: (args: { from: string; to: string; subject: string; text: string }) => Promise<void> }`
  - `buildIntegrationRequestEmail(payload: IntegrationRequestPayload): { subject: string; text: string }`
  - `sendIntegrationRequest(payload: IntegrationRequestPayload, deps?: SendIntegrationRequestDeps): Promise<{ ok: true }>` — throws `Error` with message `Email not configured yet` when key/from/to missing

- [ ] **Step 1: Install resend**

```bash
pnpm add resend
```

Expected: `resend` appears in `package.json` dependencies.

- [ ] **Step 2: Add optional env vars**

In `src/env.js` `server` schema, add:

```js
RESEND_API_KEY: z.string().min(1).optional(),
RESEND_FROM: z.string().min(1).optional(),
INTEGRATION_REQUEST_TO: z.string().email().optional(),
```

In `runtimeEnv`, add matching `process.env.*` entries.

In `.env.example`, append:

```bash
# Integration request emails (optional — requests fail clearly until set)
# RESEND_API_KEY=
# RESEND_FROM="Manycat <onboarding@resend.dev>"
# INTEGRATION_REQUEST_TO="you@example.com"
```

- [ ] **Step 3: Write failing rate-limit tests**

Create `src/server/integrations/rate-limit.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRateLimitForTests,
  assertNotRateLimited,
  markRateLimited,
} from "./rate-limit";

afterEach(() => {
  _resetRateLimitForTests();
});

describe("integration request rate limit", () => {
  it("allows first request", () => {
    expect(() => assertNotRateLimited("u1", 1_000)).not.toThrow();
  });

  it("blocks within 30s", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u1", 1_000 + 29_000)).toThrow(
      /wait before requesting/i,
    );
  });

  it("allows after 30s", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u1", 1_000 + 30_000)).not.toThrow();
  });

  it("isolates users", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u2", 1_000)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run rate-limit tests — expect FAIL**

```bash
pnpm exec vitest run src/server/integrations/rate-limit.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 5: Implement rate-limit**

Create `src/server/integrations/rate-limit.ts`:

```ts
const WINDOW_MS = 30_000;
const lastByUser = new Map<string, number>();

export function assertNotRateLimited(userKey: string, now = Date.now()): void {
  const last = lastByUser.get(userKey);
  if (last !== undefined && now - last < WINDOW_MS) {
    throw new Error("Please wait before requesting again");
  }
}

export function markRateLimited(userKey: string, now = Date.now()): void {
  lastByUser.set(userKey, now);
}

export function _resetRateLimitForTests(): void {
  lastByUser.clear();
}
```

- [ ] **Step 6: Run rate-limit tests — expect PASS**

```bash
pnpm exec vitest run src/server/integrations/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Write failing request-email tests**

Create `src/server/integrations/request-email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildIntegrationRequestEmail,
  sendIntegrationRequest,
} from "./request-email";

const base = {
  name: "Canva",
  note: "Need brand kits",
  contactEmail: "me@example.com",
  userId: "acct_1",
  userLabel: "benji",
  sessionEmail: "session@example.com",
};

describe("buildIntegrationRequestEmail", () => {
  it("includes name, note, contact, and user", () => {
    const { subject, text } = buildIntegrationRequestEmail(base);
    expect(subject).toMatch(/Canva/);
    expect(text).toContain("Canva");
    expect(text).toContain("Need brand kits");
    expect(text).toContain("me@example.com");
    expect(text).toContain("acct_1");
    expect(text).toContain("benji");
  });

  it("falls back to session email when contact omitted", () => {
    const { text } = buildIntegrationRequestEmail({
      ...base,
      contactEmail: undefined,
    });
    expect(text).toContain("session@example.com");
  });
});

describe("sendIntegrationRequest", () => {
  it("throws when not configured", async () => {
    await expect(
      sendIntegrationRequest(base, { apiKey: undefined, from: "a@b.c", to: "x@y.z" }),
    ).rejects.toThrow(/Email not configured yet/i);
  });

  it("sends when configured", async () => {
    const sendEmail = vi.fn(async () => undefined);
    await sendIntegrationRequest(base, {
      apiKey: "re_test",
      from: "Manycat <onboarding@resend.dev>",
      to: "inbox@example.com",
      sendEmail,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0]?.[0];
    expect(arg?.to).toBe("inbox@example.com");
    expect(arg?.from).toContain("Manycat");
    expect(arg?.subject).toMatch(/Canva/);
    expect(arg?.text).toContain("Need brand kits");
  });
});
```

- [ ] **Step 8: Run request-email tests — expect FAIL**

```bash
pnpm exec vitest run src/server/integrations/request-email.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 9: Implement request-email**

Create `src/server/integrations/request-email.ts`:

```ts
import { Resend } from "resend";

export type IntegrationRequestPayload = {
  name: string;
  note?: string;
  contactEmail?: string;
  userId: string;
  userLabel: string;
  sessionEmail?: string | null;
};

export type SendIntegrationRequestDeps = {
  apiKey?: string;
  from?: string;
  to?: string;
  sendEmail?: (args: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<void>;
};

export function buildIntegrationRequestEmail(payload: IntegrationRequestPayload) {
  const contact =
    payload.contactEmail?.trim() ||
    payload.sessionEmail?.trim() ||
    "(none)";
  const subject = `Integration request: ${payload.name}`;
  const text = [
    `Integration: ${payload.name}`,
    `Note: ${payload.note?.trim() || "(none)"}`,
    `Contact email: ${contact}`,
    `User: ${payload.userLabel} (${payload.userId})`,
    `At: ${new Date().toISOString()}`,
  ].join("\n");
  return { subject, text };
}

export async function sendIntegrationRequest(
  payload: IntegrationRequestPayload,
  deps: SendIntegrationRequestDeps = {},
): Promise<{ ok: true }> {
  const apiKey = deps.apiKey;
  const from = deps.from;
  const to = deps.to;
  if (!apiKey || !from || !to) {
    throw new Error("Email not configured yet");
  }

  const { subject, text } = buildIntegrationRequestEmail(payload);

  const sendEmail =
    deps.sendEmail ??
    (async (args) => {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send(args);
      if (result.error) {
        throw new Error(result.error.message || "Failed to send email");
      }
    });

  await sendEmail({ from, to, subject, text });
  return { ok: true };
}
```

- [ ] **Step 10: Run request-email tests — expect PASS**

```bash
pnpm exec vitest run src/server/integrations/request-email.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml src/env.js .env.example \
  src/server/integrations/rate-limit.ts \
  src/server/integrations/rate-limit.test.ts \
  src/server/integrations/request-email.ts \
  src/server/integrations/request-email.test.ts
git commit -m "$(cat <<'EOF'
Add Resend helpers for integration request emails.

EOF
)"
```

---

### Task 2: tRPC `integration.request` mutation

**Files:**
- Create: `src/server/api/routers/integration.ts`
- Modify: `src/server/api/root.ts`

**Interfaces:**
- Consumes: `sendIntegrationRequest`, `assertNotRateLimited`, `markRateLimited`, `env`, `protectedProcedure`
- Produces: `api.integration.request` mutation  
  Input: `{ name: string; note?: string; contactEmail?: string }`  
  Output: `{ ok: true }`  
  Errors: `UNAUTHORIZED`, `TOO_MANY_REQUESTS` (rate limit), `PRECONDITION_FAILED` (email not configured), `BAD_REQUEST` (validation), `INTERNAL_SERVER_ERROR` (send failure)

- [ ] **Step 1: Create router**

Create `src/server/api/routers/integration.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import {
  assertNotRateLimited,
  markRateLimited,
} from "@/server/integrations/rate-limit";
import { sendIntegrationRequest } from "@/server/integrations/request-email";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const integrationRouter = createTRPCRouter({
  request: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        note: z.string().trim().max(2000).optional(),
        contactEmail: z
          .string()
          .trim()
          .email()
          .optional()
          .or(z.literal("")),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userKey = ctx.accountId;
      try {
        assertNotRateLimited(userKey);
      } catch {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait before requesting again",
        });
      }

      const contactEmail = input.contactEmail?.trim() || undefined;
      const sessionEmail = ctx.session?.user?.email ?? null;
      const userLabel =
        ctx.session?.login ??
        ctx.session?.user?.name ??
        sessionEmail ??
        ctx.accountId;

      try {
        await sendIntegrationRequest(
          {
            name: input.name,
            note: input.note,
            contactEmail,
            userId: ctx.accountId,
            userLabel,
            sessionEmail,
          },
          {
            apiKey: env.RESEND_API_KEY,
            from: env.RESEND_FROM,
            to: env.INTEGRATION_REQUEST_TO,
          },
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send request";
        if (/Email not configured yet/i.test(message)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Email not configured yet",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }

      markRateLimited(userKey);
      return { ok: true as const };
    }),
});
```

Note: if Zod `.or(z.literal(""))` is awkward with optional email, prefer:

```ts
contactEmail: z.string().trim().email().optional(),
```

and coerce empty string to `undefined` in the mutation with `input.contactEmail?.trim() || undefined` after transforming input via `.transform`.

Safer input schema:

```ts
z.object({
  name: z.string().trim().min(1).max(80),
  note: z.string().trim().max(2000).optional(),
  contactEmail: z.string().trim().max(320).optional(),
}).superRefine((val, ctx) => {
  const email = val.contactEmail?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid email",
      path: ["contactEmail"],
    });
  }
})
```

Use the `superRefine` version in the actual file.

- [ ] **Step 2: Register router**

In `src/server/api/root.ts`, import and add:

```ts
import { integrationRouter } from "@/server/api/routers/integration";

export const appRouter = createTRPCRouter({
  post: postRouter,
  workflow: workflowRouter,
  project: projectRouter,
  github: githubRouter,
  integration: integrationRouter,
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS (no new errors from these files).

- [ ] **Step 4: Commit**

```bash
git add src/server/api/routers/integration.ts src/server/api/root.ts
git commit -m "$(cat <<'EOF'
Add integration.request tRPC mutation.

EOF
)"
```

---

### Task 3: Integrations sheet — grid, search, request panel

**Files:**
- Modify: `src/app/_fragments/chat/integrations-sheet.tsx` (rewrite in place)

**Interfaces:**
- Consumes: `api.integration.request.useMutation()`, `signIn` from `next-auth/react`
- Produces: `IntegrationsSheetProps = { open: boolean; onOpenChange: (open: boolean) => void; hasGitHub?: boolean; sessionEmail?: string | null }`

- [ ] **Step 1: Expand catalog + props**

Keep `"use client"`. Update catalog to include at least:

- `github` — available  
- `canva`, `vsco`, `gmail`, `n8n`, `higgsfield` — coming  
- Keep a few existing coming items (slack, notion, figma) if icons exist  

Add prop `sessionEmail?: string | null`.

Export catalog matching helper (file-local is fine):

```ts
function matchesQuery(item: Integration, q: string) {
  if (!q) return true;
  const hay = [item.name, item.description, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
```

- [ ] **Step 2: Sheet structure — header + search + modes**

State:

```ts
type Panel = "grid" | "request";
const [query, setQuery] = React.useState("");
const [panel, setPanel] = React.useState<Panel>("grid");
const [requestName, setRequestName] = React.useState("");
const [requestNote, setRequestNote] = React.useState("");
const [requestEmail, setRequestEmail] = React.useState("");
const [formError, setFormError] = React.useState<string | null>(null);
const [formOk, setFormOk] = React.useState(false);

const requestMutation = api.integration.request.useMutation();
```

On `open` false (effect): reset `query`, `panel`, form fields, errors, success.

When opening request panel from footer: `setRequestName(query.trim())` if non-empty else `""`; prefill `requestEmail` from `sessionEmail ?? ""`.

When opening from a coming tile: `setRequestName(item.name)`; same email prefill.

- [ ] **Step 3: Grid UI**

Replace the vertical list with a responsive grid, e.g.:

```tsx
<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
  {filtered.map((item) => (
    <li key={item.id}>
      <div className="flex h-full flex-col gap-3 rounded-2xl border border-border/80 px-3 py-3">
        {/* icon + name + description */}
        {/* GitHub: Connect / Connected */}
        {/* coming: Coming soon + Request button → openRequest(item.name) */}
      </div>
    </li>
  ))}
</ul>
```

GitHub Connect:

```ts
onClick={() => {
  void signIn("github", { callbackUrl: "/" });
}}
```

Sticky footer (grid panel only):

```tsx
<div className="border-border/80 border-t p-3">
  <Button className="w-full rounded-2xl" variant="outline" onClick={() => openRequest(query.trim())}>
    Request integration
  </Button>
</div>
```

Widen sheet slightly for grid: `className="w-full gap-0 p-0 sm:max-w-lg"`.

- [ ] **Step 4: Request panel UI**

When `panel === "request"`:

- Back button → `setPanel("grid"); setFormError(null); setFormOk(false)`
- Inputs: name, note (textarea or Input), contact email
- Submit button disabled while `requestMutation.isPending` or name empty
- On submit:

```ts
setFormError(null);
setFormOk(false);
try {
  await requestMutation.mutateAsync({
    name: requestName.trim(),
    note: requestNote.trim() || undefined,
    contactEmail: requestEmail.trim() || undefined,
  });
  setFormOk(true);
} catch (err) {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: string }).message)
      : "Could not send request";
  setFormError(msg);
}
```

Show success copy when `formOk`; show `formError` in muted/destructive text.

Import `api` from `@/trpc/react` (same path used elsewhere in chat fragments).

- [ ] **Step 5: Manual smoke in browser**

With `pnpm dev` running:

1. Open sheet via Build → Integrations → Browse integrations.  
2. Confirm grid + search.  
3. Open request form; submit without Resend → see **Email not configured yet**.  
4. GitHub Connect still redirects to OAuth when not connected.

- [ ] **Step 6: Commit**

```bash
git add src/app/_fragments/chat/integrations-sheet.tsx
git commit -m "$(cat <<'EOF'
Rebuild Integrations sheet with grid and request form.

EOF
)"
```

---

### Task 4: Account menu → Integrations

**Files:**
- Modify: `src/app/_fragments/chat/shell-mode-menu.tsx`
- Modify: `src/app/_fragments/chat/chat.tsx`

**Interfaces:**
- Produces: `onOpenIntegrations?: () => void` on `ShellModeMenu` and `ShellModeDrawerBody`
- Removes: Connect GitHub menu rows; `hasGitHub` may be removed from menu props if unused

- [ ] **Step 1: Update `AccountMenuItems` / drawer body**

In `shell-mode-menu.tsx`:

- Add `onOpenIntegrations?: () => void` to account props (or ModeProps & AccountProps).
- When `signedIn`, replace the `!hasGitHub` Connect GitHub block with always-shown:

```tsx
<DropdownMenuSeparator />
<DropdownMenuItem
  onClick={() => {
    onOpenIntegrations?.();
  }}
>
  Integrations
</DropdownMenuItem>
```

- Mobile drawer: replace Connect GitHub button with:

```tsx
<button
  type="button"
  className="hover:bg-muted/60 rounded-xl px-3 py-2.5 text-left text-sm font-medium"
  onClick={() => {
    onActionComplete?.();
    onOpenIntegrations?.();
  }}
>
  Integrations
</button>
```

- Remove unused `hasGitHub` from menu component props if nothing else needs it.
- Keep `signIn` imports only if still used for signed-out Continue with Google/GitHub.

- [ ] **Step 2: Wire `chat.tsx`**

Pass into both `ShellModeMenu` and `ShellModeDrawerBody`:

```tsx
onOpenIntegrations={() => setIntegrationsOpen(true)}
```

Pass into `IntegrationsSheet`:

```tsx
sessionEmail={session?.user?.email ?? null}
```

Ensure opening Integrations from the drawer closes the drawer first (`onActionComplete` already called in drawer button).

Desktop: optionally close dropdown by relying on menu item click (Base UI closes on select). If sheet fails to open because menu steals focus, set open false via menu `onOpenChange` — usually automatic.

- [ ] **Step 3: Manual verify**

1. Signed in, no GitHub: account menu shows **Integrations**, not Connect GitHub; click opens sheet.  
2. Signed in, with GitHub: menu still shows Integrations; GitHub tile Connected.  
3. Mobile drawer same.  
4. Signed out: no Integrations item.

- [ ] **Step 4: Lint/typecheck**

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS for touched files (fix any new issues introduced).

- [ ] **Step 5: Commit**

```bash
git add src/app/_fragments/chat/shell-mode-menu.tsx src/app/_fragments/chat/chat.tsx
git commit -m "$(cat <<'EOF'
Open Integrations sheet from the account menu.

EOF
)"
```

---

### Task 5: End-to-end checklist (no code unless gaps)

**Files:** none unless a bugfix is required

- [ ] **Step 1: Run unit tests**

```bash
pnpm exec vitest run src/server/integrations
```

Expected: all PASS.

- [ ] **Step 2: Manual checklist against spec**

- [ ] No Connect GitHub in signed-in menus  
- [ ] Integrations always visible when signed in  
- [ ] Sheet: search + grid + Request integration  
- [ ] Coming-soon tile prefills request name  
- [ ] Request without Resend → clear error  
- [ ] (Optional) With Resend env set → email arrives + success UI  
- [ ] GitHub Connect unchanged in effect  
- [ ] Build-mode Integrations stub still opens same sheet  

- [ ] **Step 3: Commit only if fixes were needed**

If fixes landed, commit with a focused message. Otherwise skip.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Replace Connect GitHub with Integrations | Task 4 |
| Always show when signed in | Task 4 |
| Sheet with search + grid | Task 3 |
| Request in-sheet form | Task 3 |
| GitHub Connect / Connected | Task 3 |
| Catalog includes Canva, VSCO, Gmail, n8n, Higgsfield | Task 3 |
| Prefill session email | Task 3 + Task 4 `sessionEmail` |
| Resend email persistence | Task 1–2 |
| Clear error if not configured | Task 1–3 |
| Env documented | Task 1 |
| Build nav stub still opens sheet | already wired; verified Task 5 |
| No DB / no request route | respected (non-goals) |

## Placeholder / consistency check

- Mutation name `integration.request` used consistently in Tasks 2–3.  
- Rate-limit helpers and email helpers signatures match router usage.  
- Sheet props `sessionEmail` wired in Task 4.  
- No TBD / “implement later” steps remain.
