import { describe, expect, it } from "vitest";

import {
  buildPlaceholderPlanSteps,
  coercePromptText,
} from "./plan-steps";

describe("coercePromptText", () => {
  it("keeps strings", () => {
    expect(coercePromptText("  Ship auth  ")).toBe("Ship auth");
  });

  it("unwraps common object shapes", () => {
    expect(coercePromptText({ prompt: "Do the thing" })).toBe("Do the thing");
    expect(coercePromptText({ text: "Check progress" })).toBe("Check progress");
  });

  it("does not stringify unknown objects to [object Object]", () => {
    expect(coercePromptText({ foo: 1 })).toBe("");
  });
});

describe("buildPlaceholderPlanSteps", () => {
  it("returns slots immediately without LLM", () => {
    const planned = buildPlaceholderPlanSteps({
      goalHint: "Close the deal",
      startsAt: new Date("2026-07-20T14:00:00.000Z"),
      endsAt: new Date("2026-07-21T14:00:00.000Z"),
      cadence: { kind: "interval", hours: 12 },
      timeZone: "UTC",
    });
    expect(planned.steps.length).toBeGreaterThan(0);
    expect(planned.steps[0]?.prompt).toContain("Close the deal");
    expect(planned.reasoning).toBeTruthy();
  });
});
