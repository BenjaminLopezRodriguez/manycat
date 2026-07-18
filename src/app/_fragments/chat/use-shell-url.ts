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

  const [state, setState] = React.useState<ShellState>(() => {
    if (typeof window === "undefined") {
      return { ...DEFAULT_SHELL };
    }
    return resolveBootState({
      search: window.location.search,
      storageMode: window.localStorage.getItem(STORAGE_MODE_KEY),
      lastViewRaw: window.localStorage.getItem(STORAGE_LAST_VIEW_KEY),
      enabled,
    });
  });

  const lastRef = React.useRef<LastViewByMode>(
    typeof window === "undefined"
      ? {}
      : readLastViewByMode(window.localStorage.getItem(STORAGE_LAST_VIEW_KEY)),
  );
  const prevRef = React.useRef<ShellState>(state);

  // Write URL + localStorage when shell state settles.
  // Skip history only when the URL already mirrors state (e.g. popstate).
  React.useEffect(() => {
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

  React.useEffect(() => {
    function onPopState() {
      const next = resolveBootState({
        search: window.location.search,
        storageMode: window.localStorage.getItem(STORAGE_MODE_KEY),
        lastViewRaw: window.localStorage.getItem(STORAGE_LAST_VIEW_KEY),
        enabled,
      });
      setState(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled]);

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
