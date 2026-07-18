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
  /** When false, next state write skips history (popstate already updated the URL). */
  const syncUrlRef = React.useRef(true);

  // Write URL + localStorage when shell state settles (skip history on popstate).
  React.useEffect(() => {
    const prev = prevRef.current;
    if (syncUrlRef.current) {
      applyShellToUrl(state, historyAction(prev, state));
    } else {
      syncUrlRef.current = true;
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
      syncUrlRef.current = false;
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
      const next = { ...prev, ...partial };
      if (next.mode === prev.mode && next.view === prev.view) return prev;
      return next;
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
