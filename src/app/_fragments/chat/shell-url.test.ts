import { describe, expect, it } from "vitest";
import {
  coerceShellState,
  forceDevWorkflows,
  historyAction,
  readLastViewByMode,
  resolveBootState,
  viewForModeSwitch,
} from "./shell-url";

const ALL = ["dev", "workspace", "research", "create"] as const;
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
      view: "work",
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
    expect(viewForModeSwitch("workspace", {})).toBe("work");
    expect(viewForModeSwitch("research", {})).toBe("new");
  });

  it("pushes only when mode changes", () => {
    expect(
      historyAction(
        { mode: "dev", view: "projects" },
        { mode: "research", view: "new" },
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
