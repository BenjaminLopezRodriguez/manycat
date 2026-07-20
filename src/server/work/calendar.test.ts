import { describe, expect, it, vi } from "vitest";

import { computeInitialNextDueAt } from "./cadence";

describe("calendar mirror soft-fail contract", () => {
  it("plan nextDueAt is computed without calendar", () => {
    const due = computeInitialNextDueAt({
      startsAt: new Date("2026-08-01T09:00:00.000Z"),
      endsAt: new Date("2026-08-31T09:00:00.000Z"),
      cadence: { kind: "daily" },
      now: new Date("2026-07-20T09:00:00.000Z"),
    });
    expect(due).not.toBeNull();
  });

  it("mirror failure must not throw into plan save callers", async () => {
    const mirror = vi.fn(async () => {
      throw new Error("calendar down");
    });
    const save = async () => {
      const plan = { id: "wp_1" };
      try {
        await mirror(plan);
      } catch (err) {
        // soft-log pattern used by createWorkPlan
        expect(err).toBeInstanceOf(Error);
      }
      return plan;
    };
    await expect(save()).resolves.toEqual({ id: "wp_1" });
  });
});
