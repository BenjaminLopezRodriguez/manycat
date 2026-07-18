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

**URL-driven shell state on the existing single-page chat shell.**

```
/?mode=dev&view=projects
/?mode=workspace&view=connections
/?mode=research&view=chats
```

Rejected alternatives:

- **Client-only `shellMode` state** — faster, but no shareable/deep links or back-button story  
- **Separate layout trees per mode** — clean isolation later; too much duplication for stub modes  

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
| Mode switch | Write URL with new `mode` + last remembered `view` for that mode, else home. Prefer `push` on mode change. |
| Rail switch | Update `view` only; `replace` to avoid history spam |
| Persistence | `localStorage`: `manycat.shell.mode`, `manycat.shell.lastViewByMode` |
| Boot | (1) valid URL → (2) localStorage → (3) `dev` + `projects` |
| Unknown params | Coerce to home for known mode, or `dev`/`projects` |

**Product actions that force Dev:** create-from-prompt and import write URL to Dev + `workflows` (or `projects` as appropriate) so the user is not left in another mode.

## Components

Keep logic in `chat.tsx` unless extraction stays clearly readable:

- `MODES` / `MODE_NAV` config (id, label, home, rail items with icon)  
- `ShellModeMenu` — mode radios + account actions (evolves today’s `AccountMenu`)  
- URL sync helper: parse, coerce, `setShell({ mode?, view? })`  
- Map rail + main pane off `MODE_NAV` + current mode  

Update `docs/chat-shell-nav.md` after implementation to describe mode shell instead of account-only top control.

## Edge cases

- Mode change while a Dev workflow thread is open: keep workflow state in memory; returning to Dev/`workflows` restores as today.  
- Signed-out: mode switcher still works; Workspace/Research show stubs; landing feature rail for unsigned Dev/projects path unchanged.  
- No new theming tokens for v1.

## Testing

- Unit: URL parse/coerce; last-view restore when switching modes  
- Manual: desktop dropdown + mobile drawer; deep link `/?mode=research&view=sources`; refresh keeps mode; create/import lands in Dev  

## Success criteria

1. Trigger shows mode name, not only account login.  
2. Switching mode swaps the entire Navigate rail.  
3. URL reflects mode + view; refresh and share work.  
4. Last view per mode is restored on return.  
5. Dev product paths (projects, workflows, deployments) still work.  
6. Workspace and Chat + Research are navigable stubs ready for later product work.
