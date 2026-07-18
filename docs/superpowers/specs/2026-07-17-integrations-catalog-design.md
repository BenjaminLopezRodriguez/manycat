# Integrations catalog (account menu → sheet)

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Related:** `src/app/_fragments/chat/shell-mode-menu.tsx`, `src/app/_fragments/chat/integrations-sheet.tsx`, `src/app/_fragments/chat/chat.tsx`

## Problem

The account menu exposes **Connect GitHub** as a one-off action. Integrations are broader: external tools (Canva, VSCO, Gmail, n8n, Higgsfield, etc.) that agents can use. GitHub should be one catalog entry with the same connect behavior it has today, not a special menu row.

## Goals

1. Replace **Connect GitHub** with always-visible **Integrations** when signed in (desktop dropdown + mobile drawer).  
2. Open a right **sheet** with search, a **grid** of integrations, and a **Request integration** flow.  
3. GitHub remains the only live connector in v1 (`signIn("github")` / Connected when `hasGitHub`).  
4. Request stays **in the sheet** (form + confirmation); no dedicated request route this pass.  
5. Persist requests by **email via Resend** (API key added later); clear error if not configured.  
6. Form fields: integration name, optional note, optional contact email override (session email as default hint).

## Non-goals

- Real OAuth / APIs for non-GitHub tools  
- Database table or admin UI for requests  
- Dedicated `/integrations/request` page or Build-mode banner page (deferred)  
- Centered dialog or nested dialog for the request form  
- Changing signed-out Google/GitHub continue actions  
- Hiding Integrations when GitHub is already connected

## Approach (chosen)

**Extend the existing `IntegrationsSheet`** already mounted from `chat.tsx`. Wire account menu → `setIntegrationsOpen(true)`. Convert list → searchable grid; add in-sheet request panel; add authenticated mutation that sends mail through Resend when env is set.

Rejected alternatives:

- **Centered dialog** — stronger focus mode; weaker fit with current sheet + shell patterns  
- **Sheet catalog + nested request dialog** — extra chrome for a small form  
- **UI-only request** — user wants reviewable requests via email  
- **DB-backed request queue** — heavier than needed for v1 inbox review

## Entry points

| Surface | Behavior |
|---------|----------|
| Account dropdown (signed in) | **Integrations** always shown; closes menu, opens sheet |
| Mobile account drawer (signed in) | Same |
| Build-mode nav `view=integrations` | Keep stub; **Browse integrations** opens the same sheet |
| Signed out | No Integrations item; Continue with Google / GitHub unchanged |

## Sheet UI

### Header

- Title: Integrations  
- Short description: external accounts/tools agents can use  
- Search input (name, description, keywords)

### Grid

Responsive tile grid. Each tile: icon, name, one-line description, status action.

| Status | Action |
|--------|--------|
| `available` (GitHub only in v1) | **Connect** → `signIn("github", { callbackUrl: "/" })`; if `hasGitHub`, show **Connected** |
| `coming` | Label Coming soon; action opens request panel prefilled with that name |

Empty search: short empty copy + point to Request integration.

### Request panel (in-sheet)

Entered via sticky **Request integration** or a coming-soon tile.

Fields:

- Integration name (required)  
- Note (optional)  
- Contact email (optional): **prefill** from session email when available; user may clear or override

Submit shows success or error inline. Back returns to the grid. Closing the sheet resets search and request form state.

### Catalog (static v1)

Include at least: GitHub (available), Canva, VSCO, Gmail, n8n, Higgsfield, plus a small set of existing placeholders (e.g. Slack, Notion, Figma) as coming. No runtime fetch.

## Backend

### Mutation

Authenticated procedure (preferred: new tRPC router, e.g. `integration.request`) with input:

```ts
{ name: string; note?: string; contactEmail?: string }
```

- Requires signed-in session  
- Validate non-empty trimmed `name` (max length ~80); optional note max ~2000; optional email format if provided  
- Simple in-process rate limit: reject if same user submitted within the last ~30s (good enough for v1; no Redis)

### Resend

When configured, send one email:

| Env | Purpose |
|-----|---------|
| `RESEND_API_KEY` | Optional until user adds it |
| `RESEND_FROM` | From address (e.g. Resend test sender) |
| `INTEGRATION_REQUEST_TO` | Inbox that receives requests |

Email body includes: name, note, contact email (override or session email), user id / display name, timestamp.

If Resend (or required to/from) is missing: return a clear error — **no fake success**. Document vars in `.env.example`.

### Out of scope for API

No persistence table, no list/query of past requests, no webhooks.

## Components / files (expected touch points)

- `shell-mode-menu.tsx` / `ShellModeDrawerBody` — Integrations item; `onOpenIntegrations` callback (owned state stays in `chat.tsx`)  
- `chat.tsx` — pass open handler into menu/drawer; keep `IntegrationsSheet` mount  
- `integrations-sheet.tsx` — grid, request panel, call mutation  
- New router under `src/server/api/routers/` + register in `root.ts`  
- `src/env.js` + `.env.example` — Resend / inbox vars (optional where appropriate)  
- `package.json` — add `resend` dependency

## Error handling

| Case | UX |
|------|----|
| Not signed in | Mutation rejected; sheet assumes signed-in account entry |
| Resend not configured | Inline error on submit |
| Resend API failure | Inline error; user can retry |
| Validation | Inline field / form error |

## Testing (manual)

1. Signed in without GitHub: menu shows Integrations (not Connect GitHub); sheet opens; GitHub Connect starts OAuth.  
2. Signed in with GitHub: menu still shows Integrations; GitHub tile shows Connected.  
3. Search filters tiles; empty query shows full grid.  
4. Coming-soon tile opens request form prefilled.  
5. Request with Resend unset → clear error.  
6. Request with Resend set → email arrives; success state in sheet.  
7. Mobile drawer mirrors desktop entry.

## Success criteria

- No **Connect GitHub** row in account menus when signed in.  
- Integrations opens one sheet with search + grid + request.  
- GitHub connect behavior unchanged in effect.  
- Requests attempt email delivery; misconfiguration is obvious.
