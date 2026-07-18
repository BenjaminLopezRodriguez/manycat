import {
  DEFAULT_SHELL,
  isViewInMode,
  modeHome,
  type ModeId,
  type ShellView,
} from "./shell-modes";

export const STORAGE_MODE_KEY = "manycat.shell.mode";
export const STORAGE_LAST_VIEW_KEY = "manycat.shell.lastViewByMode";

export type ShellState = { mode: ModeId; view: ShellView };
export type LastViewByMode = Partial<Record<ModeId, ShellView>>;

const ALL_MODE_IDS: ModeId[] = ["dev", "workspace", "research"];

function isModeId(value: string): value is ModeId {
  return (ALL_MODE_IDS as string[]).includes(value);
}

function isShellView(value: string): value is ShellView {
  return typeof value === "string";
}

export function parseShellSearch(
  search: string,
  enabled: ModeId[],
): ShellState | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const mode = params.get("mode");
  const view = params.get("view");
  if (mode === null && view === null) return null;
  return coerceShellState(mode, view, enabled);
}

export function coerceShellState(
  mode: string | null | undefined,
  view: string | null | undefined,
  enabled: ModeId[],
): ShellState {
  if (!mode || !isModeId(mode) || !enabled.includes(mode)) {
    return { ...DEFAULT_SHELL };
  }

  if (view && isShellView(view) && isViewInMode(mode, view)) {
    return { mode, view };
  }

  return { mode, view: modeHome(mode) };
}

export function readLastViewByMode(raw: string | null): LastViewByMode {
  if (raw === null) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const result: LastViewByMode = {};
    for (const id of ALL_MODE_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === "string" && isViewInMode(id, value as ShellView)) {
        result[id] = value as ShellView;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function resolveBootState(input: {
  search: string;
  storageMode: string | null;
  lastViewRaw: string | null;
  enabled: ModeId[];
}): ShellState {
  const fromUrl = parseShellSearch(input.search, input.enabled);
  if (fromUrl !== null) return fromUrl;

  const last = readLastViewByMode(input.lastViewRaw);
  if (input.storageMode) {
    return coerceShellState(
      input.storageMode,
      last[input.storageMode as ModeId],
      input.enabled,
    );
  }

  return { ...DEFAULT_SHELL };
}

export function viewForModeSwitch(
  mode: ModeId,
  last: LastViewByMode,
): ShellView {
  return last[mode] ?? modeHome(mode);
}

export function historyAction(
  prev: ShellState,
  next: ShellState,
): "push" | "replace" {
  return prev.mode !== next.mode ? "push" : "replace";
}

export function buildShellSearch(state: ShellState): string {
  const params = new URLSearchParams({
    mode: state.mode,
    view: state.view,
  });
  return `?${params.toString()}`;
}

export function forceDevWorkflows(): ShellState {
  return { mode: "dev", view: "workflows" };
}

export function applyShellToUrl(
  state: ShellState,
  action: "push" | "replace",
): void {
  if (typeof window === "undefined") return;

  const search = buildShellSearch(state);
  const url = `${window.location.pathname}${search}${window.location.hash}`;

  if (action === "push") {
    window.history.pushState({ manycatShell: true }, "", url);
  } else {
    window.history.replaceState({ manycatShell: true }, "", url);
  }
}

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

export function loadShellPersistence(
  storage: Pick<Storage, "getItem">,
): { storageMode: string | null; lastViewRaw: string | null } {
  return {
    storageMode: storage.getItem(STORAGE_MODE_KEY),
    lastViewRaw: storage.getItem(STORAGE_LAST_VIEW_KEY),
  };
}

export function saveShellPersistence(
  storage: Pick<Storage, "getItem" | "setItem">,
  state: ShellState,
  last: LastViewByMode,
): LastViewByMode {
  return persistShell(storage, state, last);
}
