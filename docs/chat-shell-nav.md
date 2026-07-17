# Chat shell / nav — agent handoff

Written for a future Claude/Cursor session. All of this lives in
`src/app/_fragments/chat/chat.tsx` unless noted.

## What shipped

The product chrome (left sidebar on desktop, bottom bar on mobile) was rebuilt
from a narrow icon rail into a team-scoped nav shell, roughly in the style of
Vercel / Cursor sidebars.

### Desktop (`md+`)

- Sidebar widened from `w-16` icon rail → `w-56` panel
  (`nav.bg-sidebar-primary … hidden … md:flex`).
- Top of sidebar: **status bubble** + **team dropdown** (Personal / Acme Labs /
  Northstar — mock `TEAMS` const in `chat.tsx`).
- Below that, two labeled sections:
  - **Navigate:** Projects, Workflows (unread badge), Deployments, Agents,
    Integrations
  - **Account:** Usage, Settings, Docs
- Projects / Workflows still switch the existing `view` state (`"feed"` |
  `"chats"`). The other items are UI stubs (buttons with no routes yet).

### Mobile (`md:hidden`)

- Bottom bar is no longer a tab strip. Layout is:
  `[StatusBubble] [team name ▾] ………… [☰ menu]`
- Tapping **team name** opens a **Switch team** drawer (list of `TEAMS`).
- Tapping **menu** opens a **Menu** drawer with the same Navigate + Account
  items as desktop (team list is *not* duplicated there).
- Bar is hidden while a workflow chat thread is open
  (`!(view === "chats" && chatOpen)`).

### Status bubble (`StatusBubble`)

Replaces the plain logo in both chrome surfaces. Renders
`/public/manycat-logo.png` inside a ringed circle, then overlays up to **two**
icon badges derived from live client state:

| Badge     | Icon              | When                                              |
|-----------|-------------------|---------------------------------------------------|
| `working` | `BotIcon`         | any workflow `status === "working"`               |
| `review`  | `ArrowUpRight01`  | any workflow `status === "needs-review"`          |
| `deploy`  | `ArrowUp01`       | any project `lastRun?.status === "running"`       |

Badge metadata is in `BUBBLE_BADGE`. Seed data currently includes a
`needs-review` workflow, so the amber review badge usually shows on load.
This is the intended place to pin more activity icons later (deploy ↑, etc.).

### Team model (mock only)

```ts
const TEAMS = [
  { id: "personal", name: "Personal", initials: "P" },
  { id: "acme", name: "Acme Labs", initials: "AL" },
  { id: "northstar", name: "Northstar", initials: "NS" },
] as const;
```

`teamId` is React state only — no tRPC, no DB, no persistence. Desktop uses
shadcn/`DropdownMenu` + `DropdownMenuRadioGroup`. Mobile uses a bottom
`Drawer`. Switching team does **not** yet filter projects/workflows.

### Helpers added in `chat.tsx`

- `StatusBubble` — logo + badge overlays
- `RailButton` — desktop sidebar row (optional `active`, `badge`, `onClick`)
- `MobileMenuItem` — drawer list row (same shape)

UI primitives used: `@/components/ui/dropdown-menu`, `@/components/ui/drawer`,
`Avatar`, Hugeicons from `@hugeicons/core-free-icons`.

## What is intentionally unfinished

- Deployments / Agents / Integrations / Usage / Settings / Docs — chrome only,
  no pages or routers.
- Teams are fixtures; no org membership API.
- Status badges do not yet track real deploy pipelines (only
  `Project.lastRun.status === "running"`).
- No sync between desktop dropdown and anything server-side.

## Related commits

- `dc93205` — “Ship sidebar status bubble, team drawers, and feature nav to prod.”
  (actual `chat.tsx` UI change)
- This doc commit — handoff notes so the next agent does not rediscover the above.

## Where to edit next

| Goal                         | Start here                                      |
|------------------------------|-------------------------------------------------|
| New sidebar item             | Desktop nav block + mobile Menu drawer in `chat.tsx` |
| New bubble badge kind        | `BubbleBadge` + `BUBBLE_BADGE` + `bubbleBadges` |
| Real teams                   | Replace `TEAMS` / `teamId` with tRPC + schema   |
| Wire Deployments etc.        | Add `View` variants or routes; hook `RailButton` / `MobileMenuItem` `onClick` |
