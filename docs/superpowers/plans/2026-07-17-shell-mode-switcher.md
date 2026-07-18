# Shell Mode Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add URL-driven Dev / Workspace / Chat+Research shell modes with a hybrid mode+account menu, per-mode rails, shallow history sync, localStorage last-view memory, and registry-level gating via `NEXT_PUBLIC_ENABLED_MODES`.

**Architecture:** Extract pure `shell-modes` + `shell-url` modules (TDD’d). Thin `useShellUrl` hook owns React state and `history.pushState`/`replaceState`/`popstate` (never App Router query navigations). `ShellModeMenu` replaces account-as-label. `chat.tsx` wires rail + main pane from enabled `MODES` and keeps workflow/agent state unmounted-stable across mode switches.

**Tech Stack:** Next.js 15 App Router / React 19 / Vitest / existing shadcn DropdownMenu + Drawer / `@t3-oss/env-nextjs`

**Spec:** `docs/superpowers/specs/2026-07-17-shell-mode-switcher-design.md`

## Global Constraints

- Shallow URL sync only — no `router.push`/`replace` for mode/view query changes (avoids RSC refetch).
- Extract by default: `shell-modes`, `shell-url`, `ShellModeMenu` — do not grow `chat.tsx` with this logic inline.
- `NEXT_PUBLIC_ENABLED_MODES` gates the registry; unset/empty → `dev` only; `dev` always force-included.
- No LaunchDarkly / remote flag system — single env var.
- Mode switch must not remount or reset Dev workflow thread state (workflows/`activeId`/`chatOpen` stay in `Chat`).
- Corrupt `lastViewByMode` → coerce to defaults; never throw on boot.
- History: `push` only when mode actually changes; dedupe so rapid toggling does not stack every toggle; rail view changes use `replace`.
- Workspace/Research panes are `SectionScaffold` stubs when those modes are enabled.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/env.js`, `.env.example` | `NEXT_PUBLIC_ENABLED_MODES` |
| `src/app/_fragments/chat/shell-modes.ts` | Catalog, `parseEnabledModes`, filtered `getModes` / `MODES` |
| `src/app/_fragments/chat/shell-modes.test.ts` | Flag parsing + registry filter |
| `src/app/_fragments/chat/shell-url.ts` | Parse/coerce/boot, localStorage R/W, history action helper, force-Dev |
| `src/app/_fragments/chat/shell-url.test.ts` | Boot, coerce, flag-off, force-Dev refresh, dedupe, corrupt storage |
| `src/app/_fragments/chat/use-shell-url.ts` | React hook: state + shallow history + popstate + persist |
| `src/app/_fragments/chat/shell-mode-menu.tsx` | Hybrid desktop dropdown (+ shared mode/account menu body for mobile) |
| `src/app/_fragments/chat/chat.tsx` | Wire shell; mode-scoped rail; stub panes; force Dev on import/create |
| `docs/chat-shell-nav.md` | Handoff notes for mode shell |

---

### Task 1: Env + mode registry

**Files:**
- Modify: `src/env.js`
- Modify: `.env.example`
- Create: `src/app/_fragments/chat/shell-modes.ts`
- Create: `src/app/_fragments/chat/shell-modes.test.ts`

**Interfaces:**
- Produces:
  - `export type ModeId = "dev" | "workspace" | "research"`
  - `export type ShellView` — union of all view slugs across modes
  - `export type ModeDef = { id: ModeId; label: string; home: ShellView; nav: { view: ShellView; label: string; icon: typeof News01Icon }[] }`
  - `parseEnabledModes(raw: string | undefined): ModeId[]`
  - `getModes(enabled?: ModeId[]): ModeDef[]` — defaults to `parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES)`
  - `isModeEnabled(id: ModeId, enabled?: ModeId[]): boolean`
  - `modeHome(id: ModeId): ShellView`
  - `isViewInMode(mode: ModeId, view: ShellView): boolean`
  - `DEFAULT_SHELL: { mode: "dev"; view: "projects" }`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHELL,
  getModes,
  parseEnabledModes,
} from "./shell-modes";

describe("parseEnabledModes", () => {
  it("defaults to dev only when unset or empty", () => {
    expect(parseEnabledModes(undefined)).toEqual(["dev"]);
    expect(parseEnabledModes("")).toEqual(["dev"]);
    expect(parseEnabledModes("  ")).toEqual(["dev"]);
  });

  it("parses comma-separated ids and force-includes dev", () => {
    expect(parseEnabledModes("workspace,research")).toEqual([
      "dev",
      "workspace",
      "research",
    ]);
    expect(parseEnabledModes("dev,research")).toEqual(["dev", "research"]);
  });

  it("ignores unknown tokens", () => {
    expect(parseEnabledModes("dev,nope,workspace")).toEqual([
      "dev",
      "workspace",
    ]);
  });
});

describe("getModes", () => {
  it("returns only enabled modes from the catalog", () => {
    const modes = getModes(["dev"]);
    expect(modes.map((m) => m.id)).toEqual(["dev"]);
    expect(modes[0]?.home).toBe(DEFAULT_SHELL.view);
  });

  it("includes workspace and research nav when enabled", () => {
    const ids = getModes(["dev", "workspace", "research"]).map((m) => m.id);
    expect(ids).toEqual(["dev", "workspace", "research"]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm test src/app/_fragments/chat/shell-modes.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Add env var**

In `src/env.js` client + runtimeEnv:

```js
NEXT_PUBLIC_ENABLED_MODES: z.string().optional(),
// runtimeEnv:
NEXT_PUBLIC_ENABLED_MODES: process.env.NEXT_PUBLIC_ENABLED_MODES,
```

In `.env.example` (near other `NEXT_PUBLIC_`):

```bash
# Shell modes: comma-separated. Unset/empty = dev only. Always includes dev.
# NEXT_PUBLIC_ENABLED_MODES="dev,workspace,research"
```

- [ ] **Step 4: Implement `shell-modes.ts`**

```ts
import {
  ArrowUpRight01Icon,
  BotIcon,
  BubbleChatIcon,
  CloudUploadIcon,
  Link01Icon,
  News01Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { env } from "@/env";

export type ModeId = "dev" | "workspace" | "research";

export type ShellView =
  | "projects"
  | "workflows"
  | "deployments"
  | "agents"
  | "integrations"
  | "connections"
  | "automations"
  | "activity"
  | "chats"
  | "research"
  | "sources";

export type NavItem = {
  view: ShellView;
  label: string;
  icon: typeof News01Icon;
};

export type ModeDef = {
  id: ModeId;
  label: string;
  home: ShellView;
  nav: NavItem[];
};

export const DEFAULT_SHELL = {
  mode: "dev" as const satisfies ModeId,
  view: "projects" as const satisfies ShellView,
};

const ALL_MODE_IDS: ModeId[] = ["dev", "workspace", "research"];

export const MODE_CATALOG: ModeDef[] = [
  {
    id: "dev",
    label: "Dev agents",
    home: "projects",
    nav: [
      { view: "projects", label: "Projects", icon: News01Icon },
      { view: "workflows", label: "Workflows", icon: BubbleChatIcon },
      { view: "deployments", label: "Deployments", icon: CloudUploadIcon },
      { view: "agents", label: "Agents", icon: BotIcon },
      { view: "integrations", label: "Integrations", icon: Link01Icon },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    home: "connections",
    nav: [
      { view: "connections", label: "Connections", icon: Link01Icon },
      { view: "automations", label: "Automations", icon: Settings01Icon },
      { view: "activity", label: "Activity", icon: ArrowUpRight01Icon },
    ],
  },
  {
    id: "research",
    label: "Chat + Research",
    home: "chats",
    nav: [
      { view: "chats", label: "Chats", icon: BubbleChatIcon },
      { view: "research", label: "Research", icon: Search01Icon },
      { view: "sources", label: "Sources", icon: News01Icon },
    ],
  },
];

export function parseEnabledModes(raw: string | undefined): ModeId[] {
  const tokens = (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const enabled = new Set<ModeId>();
  for (const t of tokens) {
    if ((ALL_MODE_IDS as string[]).includes(t)) enabled.add(t as ModeId);
  }
  enabled.add("dev");
  return ALL_MODE_IDS.filter((id) => enabled.has(id));
}

export function getModes(enabled?: ModeId[]): ModeDef[] {
  const allow = new Set(enabled ?? parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES));
  return MODE_CATALOG.filter((m) => allow.has(m.id));
}

export function isModeEnabled(id: ModeId, enabled?: ModeId[]): boolean {
  return (enabled ?? parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES)).includes(
    id,
  );
}

export function modeHome(id: ModeId): ShellView {
  return MODE_CATALOG.find((m) => m.id === id)?.home ?? DEFAULT_SHELL.view;
}

export function isViewInMode(mode: ModeId, view: ShellView): boolean {
  const def = MODE_CATALOG.find((m) => m.id === mode);
  return Boolean(def?.nav.some((n) => n.view === view));
}

/** Convenience: enabled modes at module evaluation (client bundle). */
export const MODES = getModes();
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm test src/app/_fragments/chat/shell-modes.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/env.js .env.example src/app/_fragments/chat/shell-modes.ts src/app/_fragments/chat/shell-modes.test.ts
git commit -m "Add gated shell mode registry and ENABLED_MODES env."
```

---

### Task 2: Shell URL + persistence helpers (pure)

**Files:**
- Create: `src/app/_fragments/chat/shell-url.ts`
- Create: `src/app/_fragments/chat/shell-url.test.ts`

**Interfaces:**
- Produces:
  - `STORAGE_MODE_KEY = "manycat.shell.mode"`
  - `STORAGE_LAST_VIEW_KEY = "manycat.shell.lastViewByMode"`
  - `type ShellState = { mode: ModeId; view: ShellView }`
  - `type LastViewByMode = Partial<Record<ModeId, ShellView>>`
  - `parseShellSearch(search: string, enabled: ModeId[]): ShellState | null` — null if no usable params
  - `coerceShellState(mode: string | null | undefined, view: string | null | undefined, enabled: ModeId[]): ShellState`
  - `readLastViewByMode(raw: string | null): LastViewByMode` — try/catch + schema; `{}` on failure
  - `resolveBootState(input: { search: string; storageMode: string | null; lastViewRaw: string | null; enabled: ModeId[] }): ShellState`
  - `viewForModeSwitch(mode: ModeId, last: LastViewByMode): ShellView`
  - `historyAction(prev: ShellState, next: ShellState): "push" | "replace"` — push iff `prev.mode !== next.mode`
  - `buildShellSearch(state: ShellState): string` — `?mode=…&view=…`
  - `forceDevWorkflows(): ShellState` — `{ mode: "dev", view: "workflows" }`
  - Storage helpers that accept `Storage`-like injectables for tests: `loadShellPersistence(storage)`, `saveShellPersistence(storage, state, last)`

- [ ] **Step 1: Write failing tests** (full cases from spec)

```ts
import { describe, expect, it } from "vitest";
import {
  coerceShellState,
  forceDevWorkflows,
  historyAction,
  readLastViewByMode,
  resolveBootState,
  viewForModeSwitch,
} from "./shell-url";

const ALL = ["dev", "workspace", "research"] as const;
const DEV_ONLY = ["dev"] as const;

describe("coerceShellState", () => {
  it("defaults unknown mode/view to dev/projects", () => {
    expect(coerceShellState("nope", "x", [...ALL])).toEqual({
      mode: "dev",
      view: "projects",
    });
  });

  it("uses mode home when view invalid for mode", () => {
    expect(coerceShellState("workspace", "projects", [...ALL])).toEqual({
      mode: "workspace",
      view: "connections",
    });
  });

  it("flag off: research coerces to dev/projects", () => {
    expect(coerceShellState("research", "sources", [...DEV_ONLY])).toEqual({
      mode: "dev",
      view: "projects",
    });
  });
});

describe("readLastViewByMode", () => {
  it("returns {} on corrupt JSON or stale shape", () => {
    expect(readLastViewByMode("not-json")).toEqual({});
    expect(readLastViewByMode('["dev"]')).toEqual({});
    expect(readLastViewByMode('{"dev":"not-a-view"}')).toEqual({});
  });

  it("keeps valid entries only", () => {
    expect(
      readLastViewByMode('{"dev":"deployments","research":"sources"}'),
    ).toEqual({ dev: "deployments", research: "sources" });
  });
});

describe("resolveBootState", () => {
  it("URL wins over localStorage mode", () => {
    const state = resolveBootState({
      search: "?mode=dev&view=workflows",
      storageMode: "research",
      lastViewRaw: JSON.stringify({
        research: "sources",
        dev: "workflows",
      }),
      enabled: [...ALL],
    });
    expect(state).toEqual({ mode: "dev", view: "workflows" });
  });

  it("falls back to storage when URL empty", () => {
    expect(
      resolveBootState({
        search: "",
        storageMode: "workspace",
        lastViewRaw: JSON.stringify({ workspace: "activity" }),
        enabled: [...ALL],
      }),
    ).toEqual({ mode: "workspace", view: "activity" });
  });

  it("flag off: localStorage restore of disabled mode coerces to default", () => {
    expect(
      resolveBootState({
        search: "",
        storageMode: "research",
        lastViewRaw: JSON.stringify({ research: "sources" }),
        enabled: [...DEV_ONLY],
      }),
    ).toEqual({ mode: "dev", view: "projects" });
  });

  it("force-Dev refresh sequence: URL dev wins; research last-view untouched by boot", () => {
    const lastViewRaw = JSON.stringify({
      research: "sources",
      dev: "workflows",
    });
    const state = resolveBootState({
      search: "?mode=dev&view=workflows",
      storageMode: "research",
      lastViewRaw,
      enabled: [...ALL],
    });
    expect(state).toEqual({ mode: "dev", view: "workflows" });
    expect(readLastViewByMode(lastViewRaw).research).toBe("sources");
  });
});

describe("viewForModeSwitch + historyAction", () => {
  it("restores last view or home", () => {
    expect(viewForModeSwitch("research", { research: "sources" })).toBe(
      "sources",
    );
    expect(viewForModeSwitch("workspace", {})).toBe("connections");
  });

  it("pushes only when mode changes", () => {
    expect(
      historyAction(
        { mode: "dev", view: "projects" },
        { mode: "research", view: "chats" },
      ),
    ).toBe("push");
    expect(
      historyAction(
        { mode: "dev", view: "projects" },
        { mode: "dev", view: "workflows" },
      ),
    ).toBe("replace");
  });
});

describe("forceDevWorkflows", () => {
  it("returns dev/workflows", () => {
    expect(forceDevWorkflows()).toEqual({ mode: "dev", view: "workflows" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/app/_fragments/chat/shell-url.test.ts`

- [ ] **Step 3: Implement `shell-url.ts`**

Implement to satisfy tests. Key rules:

```ts
// coerce: if mode not in enabled → DEFAULT_SHELL
// if view not in that mode's nav → modeHome(mode)
// readLastViewByMode: JSON.parse in try/catch; only keep ModeId keys whose value passes isViewInMode
// resolveBootState:
//   1) if search has mode or view → coerce from URL (URL wins)
//   2) else if storageMode → coerce(storageMode, last[mode], enabled)
//   3) else DEFAULT_SHELL
// historyAction: prev.mode !== next.mode ? "push" : "replace"
```

Include `applyShellToUrl(state, action: "push" | "replace")` using `window.history.pushState` / `replaceState` with `{ manycatShell: true }` state object and `buildShellSearch(state)` — used by the hook (can leave untested or smoke-test with jsdom later; vitest env is node — keep DOM writes behind `typeof window !== "undefined"`).

Persistence:

```ts
export function persistShell(
  storage: Pick<Storage, "getItem" | "setItem">,
  state: ShellState,
  last: LastViewByMode,
): LastViewByMode {
  const nextLast = { ...last, [state.mode]: state.view };
  storage.setItem(STORAGE_MODE_KEY, state.mode);
  storage.setItem(STORAGE_LAST_VIEW_KEY, JSON.stringify(nextLast));
  return nextLast;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/app/_fragments/chat/shell-url.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/_fragments/chat/shell-url.ts src/app/_fragments/chat/shell-url.test.ts
git commit -m "Add shell URL coerce, boot, and persistence helpers."
```

---

### Task 3: `useShellUrl` hook

**Files:**
- Create: `src/app/_fragments/chat/use-shell-url.ts`

**Interfaces:**
- Consumes: helpers from `shell-url.ts`, `parseEnabledModes` / `getModes` from `shell-modes.ts`
- Produces:
  ```ts
  export function useShellUrl(): {
    mode: ModeId;
    view: ShellView;
    setShell: (next: Partial<ShellState> & { mode?: ModeId; view?: ShellView }) => void;
    setMode: (mode: ModeId) => void;
    setView: (view: ShellView) => void;
    forceDevWorkflows: () => void;
  }
  ```

- [ ] **Step 1: Implement hook**

```ts
"use client";

import * as React from "react";
import { parseEnabledModes } from "./shell-modes";
import {
  applyShellToUrl,
  forceDevWorkflows as forceDevState,
  historyAction,
  persistShell,
  readLastViewByMode,
  resolveBootState,
  STORAGE_LAST_VIEW_KEY,
  STORAGE_MODE_KEY,
  viewForModeSwitch,
  type LastViewByMode,
  type ShellState,
} from "./shell-url";
import { env } from "@/env";
import type { ModeId, ShellView } from "./shell-modes";

export function useShellUrl() {
  const enabled = React.useMemo(
    () => parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES),
    [],
  );

  const [state, setState] = React.useState<ShellState>(() => {
    if (typeof window === "undefined") {
      return { mode: "dev", view: "projects" };
    }
    return resolveBootState({
      search: window.location.search,
      storageMode: window.localStorage.getItem(STORAGE_MODE_KEY),
      lastViewRaw: window.localStorage.getItem(STORAGE_LAST_VIEW_KEY),
      enabled,
    });
  });

  const lastRef = React.useRef<LastViewByMode>({});
  React.useEffect(() => {
    lastRef.current = readLastViewByMode(
      window.localStorage.getItem(STORAGE_LAST_VIEW_KEY),
    );
  }, []);

  const commit = React.useCallback(
    (next: ShellState, prev: ShellState) => {
      setState(next);
      const action = historyAction(prev, next);
      applyShellToUrl(next, action);
      lastRef.current = persistShell(
        window.localStorage,
        next,
        lastRef.current,
      );
    },
    [],
  );

  React.useEffect(() => {
    function onPopState() {
      const next = resolveBootState({
        search: window.location.search,
        storageMode: window.localStorage.getItem(STORAGE_MODE_KEY),
        lastViewRaw: window.localStorage.getItem(STORAGE_LAST_VIEW_KEY),
        enabled,
      });
      setState(next);
      lastRef.current = persistShell(
        window.localStorage,
        next,
        lastRef.current,
      );
    }
    window.addEventListener("popstate", onPopState);
    // Ensure initial URL mirrors boot state (replace, no stack entry)
    applyShellToUrl(state, "replace");
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, [enabled]);

  function setMode(mode: ModeId) {
    setState((prev) => {
      if (prev.mode === mode) return prev;
      const next = {
        mode,
        view: viewForModeSwitch(mode, lastRef.current),
      };
      queueMicrotask(() => commit(next, prev));
      return next;
    });
  }

  function setView(view: ShellView) {
    setState((prev) => {
      const next = { ...prev, view };
      queueMicrotask(() => commit(next, prev));
      return next;
    });
  }

  function setShell(partial: Partial<ShellState>) {
    setState((prev) => {
      const next = { ...prev, ...partial } as ShellState;
      queueMicrotask(() => commit(next, prev));
      return next;
    });
  }

  function forceDevWorkflows() {
    setState((prev) => {
      const next = forceDevState();
      queueMicrotask(() => commit(next, prev));
      return next;
    });
  }

  return {
    mode: state.mode,
    view: state.view,
    setShell,
    setMode,
    setView,
    forceDevWorkflows,
  };
}
```

**Important:** Prefer a cleaner commit pattern if the above double-set is awkward — e.g. single `setState` + `useEffect` that writes URL/storage when `state` changes, tracking `prev` in a ref for `historyAction`. Do **not** call `router.push`. Do **not** use `useSearchParams` (no Suspense requirement).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`  
Expected: PASS (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add src/app/_fragments/chat/use-shell-url.ts
git commit -m "Add useShellUrl shallow history hook."
```

---

### Task 4: `ShellModeMenu` (desktop + shared menu body)

**Files:**
- Create: `src/app/_fragments/chat/shell-mode-menu.tsx`
- Modify: `src/app/_fragments/chat/chat.tsx` — remove `AccountMenu`; import `ShellModeMenu`

**Interfaces:**
- Consumes: `ModeDef[]` (enabled), current `mode`, `onModeChange`, account props (same as today’s `AccountMenu`)
- Produces: `ShellModeMenu`, optionally `ShellModeDrawerBody` for mobile reuse

- [ ] **Step 1: Implement desktop menu**

Trigger label = **current mode label** (not account login). Keep small avatar optional.

Menu:

1. If `modes.length >= 2`: `DropdownMenuLabel` “Mode” + `DropdownMenuRadioGroup` of enabled modes  
2. Separator  
3. Account block (provider line / Connect GitHub / Sign out — copy from existing `AccountMenu`)

Hide the Mode section entirely when `modes.length < 2` (dev-only default).

- [ ] **Step 2: Export a drawer body** for mobile with the same Mode radios + account actions (used in Task 5).

- [ ] **Step 3: Wire into desktop sidebar** in `chat.tsx` where `AccountMenu` is today; delete `AccountMenu` function.

- [ ] **Step 4: Manual smoke** — `pnpm dev`, open menu, confirm mode label on trigger.

- [ ] **Step 5: Commit**

```bash
git add src/app/_fragments/chat/shell-mode-menu.tsx src/app/_fragments/chat/chat.tsx
git commit -m "Replace account label with hybrid ShellModeMenu."
```

---

### Task 5: Wire rail, main pane, force-Dev, mobile

**Files:**
- Modify: `src/app/_fragments/chat/chat.tsx`
- Modify: `docs/chat-shell-nav.md`

**Interfaces:**
- Consumes: `useShellUrl`, `getModes`/`MODES`, `ShellModeMenu`, stub copy for workspace/research views

- [ ] **Step 1: Replace `View` state**

Remove local `const [view, setView] = …` and `switchView`. Use:

```ts
const { mode, view, setMode, setView, forceDevWorkflows } = useShellUrl();
const modes = React.useMemo(() => getModes(), []);
const modeDef = modes.find((m) => m.id === mode) ?? modes[0]!;
```

Map main pane:

| Condition | Pane |
|-----------|------|
| `!signedIn \|\| (mode === "dev" && view === "projects")` | existing `Projects` (signed-out landing unchanged) |
| `mode === "dev" && view === "workflows"` | existing workflows + chat (unchanged tree — **do not remount** when leaving/returning; keep rendering gated by `mode === "dev" && view === "workflows"` OR keep workflows mounted but hidden via CSS/`hidden` if remount proves lossy — prefer keep state in parent and only conditional-render the pane; parent state already survives) |
| `mode === "dev" && view === "deployments"` | `DeploymentsPanel` |
| `mode === "dev" && view === "agents"` | existing Agents stub |
| `mode === "dev" && view === "integrations"` | existing Integrations stub |
| workspace views | new `SectionScaffold` copy (Connections / Automations / Activity) |
| research views | new `SectionScaffold` copy (Chats / Research / Sources) |

Stub copy examples:

- Connections: “Link Gmail, Zapier, and other apps so Workspace agents can act on your behalf.”
- Automations: “Recipes that run across your connected apps.”
- Activity: “Recent runs from Workspace agents.”
- Chats: “Conversations with the research agent.”
- Research: “Deep research threads and briefs.”
- Sources: “Docs and links the research agent can cite.”

- [ ] **Step 2: Render rail from `modeDef.nav`**

Desktop + mobile menu drawer: map `modeDef.nav` to `RailButton` / `MobileMenuItem`. Keep Account block (Usage/Settings/Docs) below divider for all modes.

Badge: Workflows unread only when `item.view === "workflows"`.

- [ ] **Step 3: Force Dev on import + create**

In `handleImportStart` / success path and `handleCreateFromPrompt` (where today `switchView("chats")` / `setView("chats")`), call `forceDevWorkflows()` instead.

- [ ] **Step 4: Mobile bottom bar**

Show **mode label** (not account name) on the mode button; open account/mode drawer with `ShellModeDrawerBody` (mode radios + account). Nav hamburger drawer lists current mode’s rail only.

Hide bottom bar when `mode === "dev" && view === "workflows" && chatOpen` (same as today’s chats+chatOpen).

- [ ] **Step 5: Preserve thread state**

Confirm `workflows`, `activeId`, `chatOpen`, agent hook stay in `Chat` parent — switching to Workspace and back to Dev/workflows must restore the open thread without clearing messages.

- [ ] **Step 6: Update `docs/chat-shell-nav.md`**

Replace team/account-only description with mode shell: URL params, `NEXT_PUBLIC_ENABLED_MODES`, extracted modules, shallow sync, per-mode rails.

- [ ] **Step 7: Verify**

```bash
pnpm test src/app/_fragments/chat/shell-modes.test.ts src/app/_fragments/chat/shell-url.test.ts
pnpm typecheck
```

Manual:

1. Default env (dev only): no Mode radios (or single-mode hidden); Dev rail works.  
2. Set `NEXT_PUBLIC_ENABLED_MODES=dev,workspace,research`, restart dev.  
3. Switch modes — URL updates, no full loading flash (no RSC refetch).  
4. Deep link `/?mode=research&view=sources`.  
5. Research → import → lands Dev/workflows; refresh stays Dev.  
6. Rapid mode toggle — back button does not walk every toggle.  
7. Open a workflow thread → switch Workspace → back to Workflows — thread intact.

- [ ] **Step 8: Commit**

```bash
git add src/app/_fragments/chat/chat.tsx docs/chat-shell-nav.md
git commit -m "Wire mode-scoped shell nav, stubs, and force-Dev paths."
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Hybrid mode+account control | 4 |
| Fully different rails per mode | 5 |
| URL `mode`+`view` | 2, 3 |
| Shallow sync / no router.push | 2, 3 (Global Constraints) |
| last view per mode + localStorage schema safety | 2 |
| Boot URL > storage > default | 2 |
| Force-Dev on import/create + refresh test | 2, 5 |
| History push dedupe on mode change | 2, 3 |
| `NEXT_PUBLIC_ENABLED_MODES` registry gate | 1, 2 |
| Flag-off coerce test | 2 |
| Extract modules | 1–4 |
| Stubs for workspace/research | 5 |
| No Dev thread remount | 5 |
| Update chat-shell-nav.md | 5 |
| No flag platform | Global Constraints / Task 1 |

## Self-review notes

- No `nuqs` dependency required — manual history API matches YAGNI.  
- `MODES` constant is fine for client; tests always call `getModes([...])` / `parseEnabledModes` with explicit lists.  
- If `useShellUrl` commit pattern races, switch to ref-tracked prev + effect writer before shipping Task 5.
