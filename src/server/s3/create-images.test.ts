import { afterEach, describe, expect, it, vi } from "vitest";

describe("createImageKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds chat-scoped keys under the configured prefix", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("S3_BUCKET", "manycat-persist");
    vi.stubEnv("S3_REGION", "us-east-2");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("S3_KEY_PREFIX", "create");

    const { createImageKey, isS3Configured } = await import("./create-images");
    expect(isS3Configured()).toBe(true);
    expect(
      createImageKey({
        accountId: "user@example.com",
        chatId: "create-123",
        imageId: "rev-1-0",
      }),
    ).toBe("create/user_example.com/create-123/rev-1-0.png");
  });

  it("reports unconfigured when credentials are missing", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("S3_BUCKET", "");
    vi.stubEnv("S3_REGION", "");
    vi.stubEnv("S3_ACCESS_KEY_ID", "");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "");

    const { isS3Configured } = await import("./create-images");
    expect(isS3Configured()).toBe(false);
  });
});
