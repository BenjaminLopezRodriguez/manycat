import { describe, expect, it } from "vitest";
import { wrapNextScaffoldBootstrapPrompt } from "./bootstrap-prompt";

describe("wrapNextScaffoldBootstrapPrompt", () => {
  it("embeds the user prompt and Next scaffold instructions", () => {
    const out = wrapNextScaffoldBootstrapPrompt("build a todo app with dark mode");
    expect(out).toContain("build a todo app with dark mode");
    expect(out).toMatch(/Next\.js App Router/i);
    expect(out).toMatch(/do not replace|do not scrap|keep the existing/i);
    expect(out).toMatch(/package\.json|next start|PORT/i);
  });
});
