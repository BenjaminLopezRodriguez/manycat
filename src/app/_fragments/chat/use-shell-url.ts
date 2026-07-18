"use client";

import * as React from "react";
import { env } from "@/env";
import {
  DEFAULT_SHELL,
  parseEnabledModes,
  type ModeId,
  type ShellView,
} from "./shell-modes";
import {
  applyShellToUrl,
  buildShellSearch,
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

function readLocationShell(enabled: ModeId[]): {
  state: ShellState;
  last: LastViewByMode;
} {
  const lastViewRaw = window.localStorage.getItem(STORAGE_LAST_VIEW_KEY);
  const last = readLastViewByMode(lastViewRaw);
  const state = resolveBootState({
    search: window.location.search,
    storageMode: window.localStorage.getItem(STORAGE_MODE_KEY),
    lastViewRaw,
    enabled,
  });
  return { state, last };
}

export function useShellUrl(): {
  mode: ModeId;
  view: ShellView;
  setShell: (
    next: Partial<ShellState> & { mode?: ModeId; view?: ShellView },
  ) => void;
  setMode: (mode: ModeId) => void;
  setView: (view: ShellView) => void;
  forceDevWorkflows: () => void;
} {
  const enabled = React.useMemo(
    () => parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES),
    [],
  );

  // Hydration-safe: identical DEFAULT_SHELL on server and first client paint.
  // Real URL/localStorage boot runs in the mount effect below.
  const [state, setState] = React.useState<ShellState>(() => ({
    ...DEFAULT_SHELL,
  }));

  const lastRef = React.useRef<LastViewByMode>({});
  const prevRef = React.useRef<ShellState>({ ...DEFAULT_SHELL });
  /** Boot wrote URL/storage; sync must wait until React state catches up. */
  const pendingBootRef = React.useRef<ShellState | null>(null);

  // Mount boot + popstate. Always resolve from window (never in useState init).
  React.useEffect(() => {
    const { state: boot, last } = readLocationShell(enabled);
    lastRef.current = last;
    applyShellToUrl(boot, "replace");
    lastRef.current = persistShell(window.localStorage, boot, lastRef.current);
    prevRef.current = boot;
    pendingBootRef.current = boot;
    setState(boot);

    function onPopState() {
      const { state: next, last: nextLast } = readLocationShell(enabled);
      lastRef.current = nextLast;
      setState(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled]);

  // Write URL + localStorage when shell state settles after boot.
  // Skip while pending boot so first-paint DEFAULT_SHELL cannot clobber deep links.
  React.useEffect(() => {
    const pending = pendingBootRef.current;
    if (pending !== null) {
      if (state.mode === pending.mode && state.view === pending.view) {
        pendingBootRef.current = null;
        prevRef.current = state;
      }
      return;
    }

    const prev = prevRef.current;
    if (window.location.search !== buildShellSearch(state)) {
      applyShellToUrl(state, historyAction(prev, state));
    }
    lastRef.current = persistShell(
      window.localStorage,
      state,
      lastRef.current,
    );
    prevRef.current = state;
  }, [state]);

  function setMode(mode: ModeId) {
    setState((prev) => {
      if (prev.mode === mode) return prev;
      return {
        mode,
        view: viewForModeSwitch(mode, lastRef.current),
      };
    });
  }

  function setView(view: ShellView) {
    setState((prev) => {
      if (prev.view === view) return prev;
      return { ...prev, view };
    });
  }

  function setShell(
    partial: Partial<ShellState> & { mode?: ModeId; view?: ShellView },
  ) {
    setState((prev) => {
      const mode = partial.mode ?? prev.mode;
      const view =
        partial.view !== undefined
          ? partial.view
          : partial.mode !== undefined && partial.mode !== prev.mode
            ? viewForModeSwitch(partial.mode, lastRef.current)
            : prev.view;
      if (mode === prev.mode && view === prev.view) return prev;
      return { mode, view };
    });
  }

  function forceDevWorkflows() {
    setState((prev) => {
      const next = forceDevState();
      if (next.mode === prev.mode && next.view === prev.view) return prev;
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
