import { describe, expect, it, vi } from "vitest";
import {
  buildIntegrationRequestEmail,
  sendIntegrationRequest,
} from "./request-email";

const base = {
  name: "Canva",
  note: "Need brand kits",
  contactEmail: "me@example.com",
  userId: "acct_1",
  userLabel: "benji",
  sessionEmail: "session@example.com",
};

describe("buildIntegrationRequestEmail", () => {
  it("includes name, note, contact, and user", () => {
    const { subject, text } = buildIntegrationRequestEmail(base);
    expect(subject).toMatch(/Canva/);
    expect(text).toContain("Canva");
    expect(text).toContain("Need brand kits");
    expect(text).toContain("me@example.com");
    expect(text).toContain("acct_1");
    expect(text).toContain("benji");
  });

  it("falls back to session email when contact omitted", () => {
    const { text } = buildIntegrationRequestEmail({
      ...base,
      contactEmail: undefined,
    });
    expect(text).toContain("session@example.com");
  });
});

describe("sendIntegrationRequest", () => {
  it("throws when not configured", async () => {
    await expect(
      sendIntegrationRequest(base, { apiKey: undefined, from: "a@b.c", to: "x@y.z" }),
    ).rejects.toThrow(/Email not configured yet/i);
  });

  it("sends when configured", async () => {
    const sendEmail = vi.fn(async () => undefined);
    await sendIntegrationRequest(base, {
      apiKey: "re_test",
      from: "Manycat <onboarding@resend.dev>",
      to: "inbox@example.com",
      sendEmail,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0]?.[0];
    expect(arg?.to).toBe("inbox@example.com");
    expect(arg?.from).toContain("Manycat");
    expect(arg?.subject).toMatch(/Canva/);
    expect(arg?.text).toContain("Need brand kits");
  });
});
