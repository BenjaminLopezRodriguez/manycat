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
