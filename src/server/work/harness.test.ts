import { describe, expect, it } from "vitest";

import { cadenceForHours, parseToolCall } from "./harness";

describe("parseToolCall", () => {
  it("parses set_goal_timeframe block", () => {
    const text = `Sure.
<<<TOOL set_goal_timeframe
{"hours":24,"goal":"Close the Acme deal","notify":true}
TOOL>>>`;
    expect(parseToolCall(text)).toEqual({
      hours: 24,
      goal: "Close the Acme deal",
      notify: true,
    });
  });

  it("rejects invalid hours", () => {
    expect(
      parseToolCall(`<<<TOOL set_goal_timeframe
{"hours":9,"goal":"x","notify":true}
TOOL>>>`),
    ).toBeNull();
  });
});

describe("cadenceForHours", () => {
  it("picks interval vs daily", () => {
    expect(cadenceForHours(6)).toEqual({ kind: "interval", hours: 6 });
    expect(cadenceForHours(168)).toEqual({ kind: "daily" });
  });
});
