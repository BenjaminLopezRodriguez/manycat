import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRateLimitForTests,
  assertNotRateLimited,
  markRateLimited,
} from "./rate-limit";

afterEach(() => {
  _resetRateLimitForTests();
});

describe("integration request rate limit", () => {
  it("allows first request", () => {
    expect(() => assertNotRateLimited("u1", 1_000)).not.toThrow();
  });

  it("blocks within 30s", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u1", 1_000 + 29_000)).toThrow(
      /wait before requesting/i,
    );
  });

  it("allows after 30s", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u1", 1_000 + 30_000)).not.toThrow();
  });

  it("isolates users", () => {
    markRateLimited("u1", 1_000);
    expect(() => assertNotRateLimited("u2", 1_000)).not.toThrow();
  });
});
