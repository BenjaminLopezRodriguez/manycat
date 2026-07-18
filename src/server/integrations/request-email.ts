import { Resend } from "resend";

export type IntegrationRequestPayload = {
  name: string;
  note?: string;
  contactEmail?: string;
  userId: string;
  userLabel: string;
  sessionEmail?: string | null;
};

export type SendIntegrationRequestDeps = {
  apiKey?: string;
  from?: string;
  to?: string;
  sendEmail?: (args: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<void>;
};

function nonempty(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

export function buildIntegrationRequestEmail(payload: IntegrationRequestPayload) {
  const contact =
    nonempty(payload.contactEmail) ??
    nonempty(payload.sessionEmail) ??
    "(none)";
  const subject = `Integration request: ${payload.name}`;
  const text = [
    `Integration: ${payload.name}`,
    `Note: ${nonempty(payload.note) ?? "(none)"}`,
    `Contact email: ${contact}`,
    `User: ${payload.userLabel} (${payload.userId})`,
    `At: ${new Date().toISOString()}`,
  ].join("\n");
  return { subject, text };
}

export async function sendIntegrationRequest(
  payload: IntegrationRequestPayload,
  deps: SendIntegrationRequestDeps = {},
): Promise<{ ok: true }> {
  const apiKey = deps.apiKey;
  const from = deps.from;
  const to = deps.to;
  if (!apiKey || !from || !to) {
    throw new Error("Email not configured yet");
  }

  const { subject, text } = buildIntegrationRequestEmail(payload);

  const sendEmail =
    deps.sendEmail ??
    (async (args) => {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send(args);
      if (result.error) {
        throw new Error(result.error.message || "Failed to send email");
      }
    });

  await sendEmail({ from, to, subject, text });
  return { ok: true };
}
