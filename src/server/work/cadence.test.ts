import { describe, expect, it } from "vitest";

import {
  advanceDueAt,
  computeInitialNextDueAt,
  computeNextDueAfterFire,
  isWithinPlanWindow,
} from "./cadence";

describe("advanceDueAt", () => {
  it("advances daily by one UTC day", () => {
    const from = new Date("2026-07-20T15:00:00.000Z");
    expect(advanceDueAt(from, { kind: "daily" }).toISOString()).toBe(
      "2026-07-21T15:00:00.000Z",
    );
  });

  it("skips weekends for weekdays cadence", () => {
    const friday = new Date("2026-07-17T12:00:00.000Z"); // Friday
    expect(advanceDueAt(friday, { kind: "weekdays" }).toISOString()).toBe(
      "2026-07-20T12:00:00.000Z",
    );
  });

  it("advances by interval hours", () => {
    const from = new Date("2026-07-20T10:00:00.000Z");
    expect(
      advanceDueAt(from, { kind: "interval", hours: 6 }).toISOString(),
    ).toBe("2026-07-20T16:00:00.000Z");
  });
});

describe("computeInitialNextDueAt", () => {
  it("returns startsAt when still in the future", () => {
    const due = computeInitialNextDueAt({
      startsAt: new Date("2026-08-01T09:00:00.000Z"),
      endsAt: new Date("2026-08-31T09:00:00.000Z"),
      cadence: { kind: "daily" },
      now: new Date("2026-07-20T09:00:00.000Z"),
    });
    expect(due?.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("returns null when window already ended", () => {
    const due = computeInitialNextDueAt({
      startsAt: new Date("2026-06-01T09:00:00.000Z"),
      endsAt: new Date("2026-06-30T09:00:00.000Z"),
      cadence: { kind: "daily" },
      now: new Date("2026-07-20T09:00:00.000Z"),
    });
    expect(due).toBeNull();
  });

  it("advances from startsAt when plan already started", () => {
    const due = computeInitialNextDueAt({
      startsAt: new Date("2026-07-18T09:00:00.000Z"),
      endsAt: new Date("2026-07-30T09:00:00.000Z"),
      cadence: { kind: "daily" },
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    expect(due?.toISOString()).toBe("2026-07-21T09:00:00.000Z");
  });
});

describe("computeNextDueAfterFire", () => {
  it("returns null when next would pass endsAt", () => {
    const next = computeNextDueAfterFire({
      firedAt: new Date("2026-07-30T09:00:00.000Z"),
      endsAt: new Date("2026-07-30T18:00:00.000Z"),
      cadence: { kind: "daily" },
    });
    expect(next).toBeNull();
  });
});

describe("isWithinPlanWindow", () => {
  it("includes boundaries", () => {
    const startsAt = new Date("2026-07-01T00:00:00.000Z");
    const endsAt = new Date("2026-07-31T00:00:00.000Z");
    expect(
      isWithinPlanWindow({
        at: startsAt,
        startsAt,
        endsAt,
      }),
    ).toBe(true);
    expect(
      isWithinPlanWindow({
        at: endsAt,
        startsAt,
        endsAt,
      }),
    ).toBe(true);
    expect(
      isWithinPlanWindow({
        at: new Date("2026-08-01T00:00:00.000Z"),
        startsAt,
        endsAt,
      }),
    ).toBe(false);
  });
});
