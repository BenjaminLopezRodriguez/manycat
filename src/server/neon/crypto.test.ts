import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("neon crypto", () => {
  it("round-trips", () => {
    const key = "test-encryption-key-32chars-min!!";
    const enc = encryptSecret("s3cret", key);
    expect(enc).not.toContain("s3cret");
    expect(decryptSecret(enc, key)).toBe("s3cret");
  });
});
