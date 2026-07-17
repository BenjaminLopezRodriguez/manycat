import { describe, expect, it } from "vitest";
import {
  hardenWorkspaceForRailway,
  SCAFFOLD_NEXT_VERSION,
  scaffoldNextFromPrompt,
} from "./scaffold-next";

describe("scaffoldNextFromPrompt", () => {
  it("emits Next production scripts and railway.toml", () => {
    const files = scaffoldNextFromPrompt("hello dashboard");
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.contents]));
    expect(byPath["package.json"]).toContain('"next"');
    expect(byPath["package.json"]).toContain(SCAFFOLD_NEXT_VERSION);
    expect(byPath["package.json"]).toContain('"build"');
    expect(byPath["package.json"]).toContain("next start");
    expect(byPath["railway.toml"]).toMatch(/npm (install|run)/);
    expect(byPath["railway.toml"]).not.toContain("pnpm");
    expect(byPath["app/page.tsx"]).toBeTruthy();
  });
});

describe("hardenWorkspaceForRailway", () => {
  it("bumps vulnerable next pins before mirror", () => {
    const [pkg] = hardenWorkspaceForRailway([
      {
        path: "package.json",
        contents: JSON.stringify({
          dependencies: { next: "15.2.3", react: "^19.0.0" },
        }),
      },
    ]);
    expect(JSON.parse(pkg!.contents).dependencies.next).toBe(
      SCAFFOLD_NEXT_VERSION,
    );
  });

  it("rewrites pnpm railway.toml to npm", () => {
    const [toml] = hardenWorkspaceForRailway([
      {
        path: "railway.toml",
        contents: `[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm build"

[deploy]
startCommand = "pnpm start"
`,
      },
    ]);
    expect(toml!.contents).toContain("npm install && npm run build");
    expect(toml!.contents).toContain('startCommand = "npm run start"');
    expect(toml!.contents).not.toContain("pnpm");
  });
});
