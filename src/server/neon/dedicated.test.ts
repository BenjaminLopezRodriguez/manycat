import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dedicated neon", () => {
  it("fails loud without falling back to shared when API errors", async () => {
    vi.stubEnv("NEON_API_KEY", "test-neon-key");
    vi.stubEnv("NEON_ORG_ID", "org-test");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ensureAppDatabase } = await import("./provision");

    await expect(
      ensureAppDatabase({
        accountId: "a",
        workflowId: "w1",
        plan: "sub",
      }),
    ).rejects.toThrow(/dedicated|Neon|boom/i);

    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws when Neon API credentials are missing (no shared fallback)", async () => {
    vi.stubEnv("NEON_API_KEY", "");
    vi.stubEnv("NEON_ORG_ID", "");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/control");
    vi.resetModules();
    const { ensureAppDatabase } = await import("./provision");

    await expect(
      ensureAppDatabase({
        accountId: "a",
        workflowId: "w1",
        plan: "metered",
      }),
    ).rejects.toThrow(/Dedicated Neon not configured|fail loud|no shared fallback/i);
  });
});
