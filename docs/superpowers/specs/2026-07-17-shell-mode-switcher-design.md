# Shell mode switcher (Dev / Workspace / Chat + Research)

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Related:** `docs/chat-shell-nav.md`, `src/app/_fragments/chat/chat.tsx`

## Problem

The chat shell presents one fixed rail (Projects, Workflows, Deployments, Agents, Integrations) and an account dropdown labeled with the signed-in user (`local-dev`, etc.). Users need to switch between three product modes:

1. **Dev agents** — current Cursor-like coding / projects / deploy shell  
2. **Workspace** — connect apps (Gmail, Zapier, etc.) and automations  
3. **Chat + Research** — chat and research surfaces  

The top control is the natural place to switch modes; the rail should fully change per mode. Full connector OAuth and research agents are out of scope for this pass — this ships the **mode shell** only.

## Goals

1. Hybrid top control: **mode name** is the visible label; menu includes mode radios plus existing account actions.  
2. Fully different nav sets per mode (not relabeled slots).  
3. URL-driven `mode` + `view` on `/`.  
4. Default home per mode; remember last view per mode (localStorage).  
5. Dev keeps existing wired views; Workspace and Chat + Research use `SectionScaffold` stubs.  
6. Desktop and mobile share the same mode model.

## Non-goals

- OAuth / real Workspace connectors  
- Real research agent, sources backend, or new chat persistence beyond today’s workflows  
- Separate App Router trees (`/workspace/...`) — query params on `/` for this pass  
- Visual color “themes” per mode  
- Server-side persistence of shell preference  
- Replacing signed-out landing feature rail with mode-specific marketing

## Approach (chosen)

**URL-driven shell state on the existing single-page chat shell**, with **shallow** history sync (not App Router navigations that refetch RSC).

```
/?mode=dev&view=projects
/?mode=workspace&view=connections
/?mode=research&view=chats
```

Rejected alternatives:

- **Client-only `shellMode` state** — faster, but no shareable/deep links or back-button story  
- **Separate layout trees per mode** — clean isolation later; too much duplication for stub modes  
- **`router.push`/`replace` for query-only changes** — triggers RSC payload refetch; wrong for a pure client shell  

## Modes & nav

**Shared Account block** (all modes, below divider): Usage · Settings · Docs (stubs, unchanged).

| Mode id | Label (trigger) | Home `view` | Rail `view` slugs (order) | Main pane |
|---------|-----------------|-------------|---------------------------|-----------|
| `dev` | Dev agents | `projects` | `projects`, `workflows`, `deployments`, `agents`, `integrations` | Projects / Workflows / Deployments wired as today; Agents & Integrations stay stubs |
| `workspace` | Workspace | `connections` | `connections`, `automations`, `activity` | All `SectionScaffold` stubs (Gmail/Zapier/connectors framing) |
| `research` | Chat + Research | `chats` | `chats`, `research`, `sources` | All `SectionScaffold` stubs (chat/research framing) |

**Slug migration (Dev):** today’s in-memory `feed` → `projects`, `chats` → `workflows`. Internal workflow chat open state stays client-only (not in the URL for v1).

## Top control (hybrid)

**Trigger:** mode label + chevron; optional small avatar/initials; status bubble unchanged beside it.

**Menu order:**

1. Section: Mode  
2. Radio: Dev agents · Workspace · Chat + Research  
3. Separator  
4. Account: signed-in provider line / Connect GitHub / Sign out — or Google/GitHub sign-in when signed out  

**Mobile:** bottom-bar label shows current mode; drawer mirrors the same Mode + Account structure (not a separate team switcher).

## URL, persistence, boot

| Piece | Behavior |
|-------|----------|
| `mode` | `dev` \| `workspace` \| `research` |
| `view` | Mode-specific slug; invalid combo → that mode’s home |
| Mode switch | Write URL with new `mode` + last remembered `view` for that mode, else home. `push` only when mode **actually changes**, and dedupe so the previous history entry is not the same mode (rapid toggling must not stack every toggle). |
| Rail switch | Update `view` only; `replace` to avoid history spam |
| Persistence | `localStorage`: `manycat.shell.mode`, `manycat.shell.lastViewByMode` (single JSON blob) |
| Boot | (1) valid URL → (2) localStorage → (3) `dev` + `projects` |
| Unknown / corrupt | Coerce URL params to home for known mode, or `dev`/`projects`. On localStorage parse failure or stale shape: try/catch + schema validation → coerce to defaults (same as URL rules). Never throw during boot. |

### Shallow URL sync (required)

This is a pure client shell. Do **not** drive mode/view with naive `router.push` / `router.replace` query updates alone — in the App Router that refetches the RSC payload on every switch and feels sluggish.

Also: `useSearchParams` requires a Suspense boundary if used.

**Preferred:** shallow sync via `window.history.pushState` / `replaceState` + `popstate` listener (or `nuqs` / equivalent shallow-routing helper). Keep React state as the live source; URL mirrors it for share/refresh/back. Sync `localStorage` whenever mode/view settles.

### Product actions that force Dev

Create-from-prompt and import write URL to Dev + `workflows` (or `projects` as appropriate) so the user is not left in another mode. They should also update `manycat.shell.mode` (and last-view for Dev) so persistence matches the URL.

**Sequence that must be tested:** user in Research → clicks import (forced to Dev) → refreshes. URL says `dev` (wins over localStorage). `lastViewByMode.research` may still be stale; returning to Research later restores that last research view (expected), not whatever was open mid-import. Assert: after force-Dev, boot from URL stays on Dev; Research last-view is unchanged until the user visits Research again.

## Components

**Default: extract.** `chat.tsx` already owns sidebar, mobile bar, account menu, project config, and agent events, with multiple agents editing it. This feature is the forcing function to stop growing it.

Extract unless extraction is clearly worse:

| Module | Responsibility |
|--------|----------------|
| `MODE_NAV` / `MODES` config | Mode ids, labels, homes, rail items + icons — pure data, no React |
| `ShellModeMenu` | Mode radios + account actions (evolves today’s `AccountMenu`) |
| URL-sync helper | Parse, coerce, shallow `setShell({ mode?, view? })`, popstate, localStorage read/write with schema validation |

`chat.tsx` wires extracted pieces into the shell and maps main pane off current mode/view. Workflow / agent state stays in `chat.tsx` (or existing agent modules) so mode switches do not remount or reset Dev thread state.

Update `docs/chat-shell-nav.md` after implementation to describe mode shell instead of account-only top control.

## Edge cases

- Mode change while a Dev workflow thread is open: keep workflow state in memory; do not remount the thread; returning to Dev/`workflows` restores as today.  
- Signed-out: mode switcher still works; Workspace/Research show stubs; landing feature rail for unsigned Dev/projects path unchanged.  
- No new theming tokens for v1.  
- Corrupt / stale `lastViewByMode` JSON: coerce to defaults, continue boot.  
- Back button: walks meaningful mode entries only (deduped pushes), not every rapid toggle.

## Testing

- Unit: URL parse/coerce; last-view restore when switching modes; localStorage schema failure → defaults  
- Unit (force-Dev sequence): Research → import forces Dev → simulate refresh with `mode=dev` in URL and `mode=research` still in localStorage → boot lands Dev; Research last-view unchanged until revisited  
- Unit: mode toggle history dedupe (push only on real mode change; no stack explosion)  
- Manual: desktop dropdown + mobile drawer; deep link `/?mode=research&view=sources`; refresh keeps mode; create/import lands in Dev; mode switch away and back does not wipe open Dev workflow thread  

## Success criteria

1. Trigger shows mode name, not only account login.  
2. Switching mode swaps the entire Navigate rail.  
3. URL reflects mode + view; refresh and share work.  
4. Last view per mode is restored on return.  
5. Dev product paths (projects, workflows, deployments) still work.  
6. Workspace and Chat + Research are navigable stubs ready for later product work.  
7. Mode switch does not remount or reset Dev workflow thread state.  
8. Mode/view URL updates do not trigger App Router RSC refetches (shallow sync).
