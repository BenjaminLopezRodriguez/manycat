import { NextResponse } from "next/server";

import { env } from "@/env";
import { tickWorkPlans } from "@/server/work/fire";
import { ensurePersistenceSchema } from "@/server/workflow/persist";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/** Due Work plans: seed session, runChat, notify owner. */
export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensurePersistenceSchema();
  const result = await tickWorkPlans();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}
