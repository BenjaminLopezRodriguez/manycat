import { describe, expect, it } from "vitest";

import {
  expandScheduleSlots,
  formatPromptSlotLabel,
} from "./schedule-preview";

describe("formatPromptSlotLabel", () => {
  it("formats like 2:10pm Monday in UTC", () => {
    const at = new Date("2026-07-20T14:10:00.000Z");
    const label = formatPromptSlotLabel(at, "UTC");
    expect(label.toLowerCase()).toContain("monday");
    expect(label.toLowerCase()).toMatch(/\d/);
  });
});

describe("expandScheduleSlots", () => {
  it("lists daily slots inside the window", () => {
    const slots = expandScheduleSlots({
      startsAt: new Date("2026-07-20T14:10:00.000Z"),
      endsAt: new Date("2026-07-23T14:10:00.000Z"),
      cadence: { kind: "daily" },
      timeZone: "UTC",
      now: new Date("2026-07-19T00:00:00.000Z"),
      limit: 10,
    });
    expect(slots.length).toBeGreaterThanOrEqual(3);
    expect(slots[0]?.label.toLowerCase()).toContain("monday");
  });
});
