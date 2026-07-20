import { Resend } from "resend";

import { env } from "@/env";

export async function sendWorkPlanDueEmail(opts: {
  to: string;
  planId: string;
  workflowId: string;
  preview: string;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!apiKey || !from) {
    return { ok: true, skipped: true };
  }

  const base = env.AUTH_URL ?? "https://manycat.app";
  const link = `${base}/?mode=workspace&view=work&session=${encodeURIComponent(opts.workflowId)}`;
  const subject = "Your Manycat Work session is ready";
  const text = [
    "A scheduled Work session is ready for you.",
    "",
    opts.preview.slice(0, 400),
    "",
    `Open: ${link}`,
  ].join("\n");

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({ from, to: opts.to, subject, text });
  if (result.error) {
    throw new Error(result.error.message || "Failed to send email");
  }
  return { ok: true };
}
