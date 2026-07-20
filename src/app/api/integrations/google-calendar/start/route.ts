import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { env } from "@/env";
import {
  googleCalendarAuthUrl,
  googleCalendarConfigured,
} from "@/server/work/calendar";

export const runtime = "nodejs";

function oauthState(accountId: string) {
  const nonce = Date.now().toString(36);
  const payload = `${accountId}:${nonce}`;
  const sig = createHash("sha256")
    .update(`${payload}:${env.AUTH_SECRET ?? "dev"}`)
    .digest("hex")
    .slice(0, 16);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

/** Start Google Calendar OAuth (write-only mirror). */
export async function GET() {
  const session = await auth();
  const accountId = session?.accountId;
  if (!accountId) {
    return NextResponse.redirect(new URL("/signin", env.AUTH_URL ?? "http://localhost:3000"));
  }
  if (!googleCalendarConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar OAuth is not configured" },
      { status: 503 },
    );
  }

  const state = oauthState(accountId);
  const url = googleCalendarAuthUrl({ accountId, state });
  return NextResponse.redirect(url);
}
