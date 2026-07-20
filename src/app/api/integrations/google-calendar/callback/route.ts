import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { env } from "@/env";
import {
  exchangeGoogleCalendarCode,
  upsertGoogleCalendarTokens,
} from "@/server/work/calendar";
import { ensurePersistenceSchema } from "@/server/workflow/persist";

export const runtime = "nodejs";

function verifyState(state: string, accountId: string): boolean {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [id, nonce, sig] = decoded.split(":");
    if (!id || !nonce || !sig || id !== accountId) return false;
    const expect = createHash("sha256")
      .update(`${id}:${nonce}:${env.AUTH_SECRET ?? "dev"}`)
      .digest("hex")
      .slice(0, 16);
    return sig === expect;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const session = await auth();
  const accountId = session?.accountId;
  const base = env.AUTH_URL ?? "http://localhost:3000";
  const fail = new URL("/?mode=workspace&view=connections&calendar=error", base);
  const ok = new URL("/?mode=workspace&view=connections&calendar=connected", base);

  if (!accountId) {
    return NextResponse.redirect(new URL("/signin", base));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !verifyState(state, accountId)) {
    return NextResponse.redirect(fail);
  }

  try {
    await ensurePersistenceSchema();
    const tokens = await exchangeGoogleCalendarCode(code);
    await upsertGoogleCalendarTokens({
      accountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    return NextResponse.redirect(ok);
  } catch (err) {
    console.warn(
      "[google-calendar callback]",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.redirect(fail);
  }
}
