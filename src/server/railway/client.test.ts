import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("assertWorkloadDatabaseUrl", () => {
  it("rejects empty url", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.resetModules();
    const { assertWorkloadDatabaseUrl } = await import("./client");
    expect(() => assertWorkloadDatabaseUrl("")).toThrow(
      /workload DATABASE_URL required/,
    );
  });

  it("rejects control DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("NEON_SHARED_DATABASE_URL", "postgres://localhost/shared-admin");
    vi.resetModules();
    const { assertWorkloadDatabaseUrl } = await import("./client");
    expect(() =>
      assertWorkloadDatabaseUrl("postgres://localhost/control"),
    ).toThrow(/Refusing to inject control DATABASE_URL/);
  });

  it("rejects admin NEON_SHARED_DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("NEON_SHARED_DATABASE_URL", "postgres://localhost/shared-admin");
    vi.resetModules();
    const { assertWorkloadDatabaseUrl } = await import("./client");
    expect(() =>
      assertWorkloadDatabaseUrl("postgres://localhost/shared-admin"),
    ).toThrow(/Refusing to inject admin shared Neon URL/);
  });

  it("allows a distinct workload role url", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.stubEnv("NEON_SHARED_DATABASE_URL", "postgres://localhost/shared-admin");
    vi.resetModules();
    const { assertWorkloadDatabaseUrl } = await import("./client");
    expect(() =>
      assertWorkloadDatabaseUrl("postgres://app_role:pw@localhost/shared"),
    ).not.toThrow();
  });
});
