# Chat shell / nav — agent handoff

Written for a future Claude/Cursor session. Shell chrome lives mainly in
`src/app/_fragments/chat/chat.tsx`, with mode/URL helpers extracted beside it.

## What shipped

The product chrome (left sidebar on desktop, bottom bar on mobile) is a
**mode-scoped shell**: Dev agents, Workspace, and Chat + Research. The top
control shows the **mode label** (not the account login); the menu is hybrid
Mode radios + account actions.

### URL + persistence

Shallow client sync only (`history.pushState` / `replaceState` + `popstate`).
Do **not** drive `mode`/`view` with App Router `router.push` — that refetches RSC.

| Piece | Behavior |
|-------|----------|
| Params | `/?mode=dev&view=projects` (and peers) |
| Mode switch | `push` when mode actually changes (deduped) |
| Rail switch | `replace` on `view` only |
| Storage | `manycat.shell.mode`, `manycat.shell.lastViewByMode` |
| Boot | URL → localStorage → `dev` + `projects` |
| Gate | `NEXT_PUBLIC_ENABLED_MODES` (comma-separated; default `dev` only; `dev` always included) |

Modules:

| File | Role |
|------|------|
| `shell-modes.ts` | Catalog, `getModes` / `MODES`, nav per mode |
| `shell-url.ts` | Parse/coerce, persist, shallow history helpers |
| `use-shell-url.ts` | React hook: `mode`/`view`/`setMode`/`setView`/`forceDevWorkflows` |
| `shell-mode-menu.tsx` | `ShellModeMenu` + `ShellModeDrawerBody` |

### Modes & rails

Shared **Account** block (all modes, below divider): Usage · Settings · Docs.

| Mode | Home | Rail views |
|------|------|------------|
| `dev` | `projects` | projects, workflows, deployments, agents, integrations |
| `workspace` | `connections` | connections, automations, activity |
| `research` | `chats` | chats, research, sources |

Dev projects / workflows / deployments stay wired. Agents, Integrations, and all
Workspace / Research panes use `SectionScaffold` stubs.

Slug migration from the old in-memory shell: `feed` → `projects`, `chats` →
`workflows`. Workflow thread open state (`chatOpen`) stays client-only.

### Desktop (`md+`)

- Sidebar `w-56`: status bubble + `ShellModeMenu` (mode label + account menu).
- Navigate section is **fully replaced** per `modeDef.nav` (not relabeled slots).
- Workflows unread badge only when the nav item’s `view === "workflows"`.

### Mobile (`md:hidden`)

- Bottom bar: `[StatusBubble] [mode label ▾] ………… [☰ menu]`
- Mode button opens a drawer with `ShellModeDrawerBody` (mode radios + account).
- Hamburger lists the **current mode’s** rail + Account stubs.
- Bar hidden while `mode === "dev" && view === "workflows" && chatOpen`.

### Force-Dev product paths

Create-from-prompt and import call `forceDevWorkflows()` so the shell lands on
Dev + `workflows` (URL + localStorage mode / Dev last-view). Workflow /
`activeId` / `chatOpen` state stays in `Chat` parent so mode switches do not
wipe an open Dev thread.

### Status bubble (`StatusBubble`)

Same as before: logo + up to two badges (`working` / `review` / `deploy`) from
live client state. Metadata in `BUBBLE_BADGE`.

## What is intentionally unfinished

- Workspace connectors / OAuth, research agent backend, sources persistence.
- Deployments / Agents / Integrations / Usage / Settings / Docs — chrome or stubs only where noted.
- No per-mode visual themes; no server-side shell preference; no flag platform
  beyond `NEXT_PUBLIC_ENABLED_MODES`.

## Where to edit next

| Goal | Start here |
|------|------------|
| New mode or rail item | `shell-modes.ts` catalog + pane map in `chat.tsx` |
| URL / restore rules | `shell-url.ts` + `use-shell-url.ts` |
| Mode / account menu | `shell-mode-menu.tsx` |
| Wire a stub pane | Main-pane branch in `chat.tsx` |
| New bubble badge | `BubbleBadge` + `BUBBLE_BADGE` + `bubbleBadges` |
