import { describe, expect, it } from "vitest";
import { scaffoldNextFromPrompt } from "./scaffold-next";

describe("scaffoldNextFromPrompt", () => {
  it("emits Next production scripts and railway.toml", () => {
    const files = scaffoldNextFromPrompt("hello dashboard");
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.contents]));
    expect(byPath["package.json"]).toContain('"next"');
    expect(byPath["package.json"]).toContain('"build"');
    expect(byPath["package.json"]).toContain("next start");
    expect(byPath["railway.toml"]).toMatch(/build|start/i);
    expect(byPath["app/page.tsx"]).toBeTruthy();
  });
});
