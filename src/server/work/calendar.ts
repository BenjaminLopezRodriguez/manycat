import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { env } from "@/env";
import { db } from "@/server/db";
import { oauthConnections, type workPlans } from "@/server/db/schema";
import { decryptSecret, encryptSecret } from "@/server/neon/crypto";

type WorkPlanRow = typeof workPlans.$inferSelect;

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

function connectionId() {
  return `oc_${randomBytes(12).toString("hex")}`;
}

function encryptionKey(): string | null {
  return env.APP_DB_ENCRYPTION_KEY ?? null;
}

export function googleCalendarConfigured(): boolean {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && env.AUTH_URL);
}

export function googleCalendarAuthUrl(opts: {
  accountId: string;
  state: string;
}): string {
  if (!googleCalendarConfigured()) {
    throw new Error("Google Calendar OAuth is not configured");
  }
  const redirectUri = `${env.AUTH_URL}/api/integrations/google-calendar/callback`;
  const params = new URLSearchParams({
    client_id: env.AUTH_GOOGLE_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function upsertGoogleCalendarTokens(opts: {
  accountId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string;
}) {
  const key = encryptionKey();
  if (!key) throw new Error("APP_DB_ENCRYPTION_KEY not configured");

  const [existing] = await db
    .select()
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.accountId, opts.accountId),
        eq(oauthConnections.provider, "google_calendar"),
      ),
    )
    .limit(1);

  const accessTokenEnc = encryptSecret(opts.accessToken, key);
  const refreshTokenEnc = opts.refreshToken
    ? encryptSecret(opts.refreshToken, key)
    : existing?.refreshTokenEnc ?? null;

  if (existing) {
    await db
      .update(oauthConnections)
      .set({
        accessTokenEnc,
        refreshTokenEnc,
        scopes: opts.scopes ?? CALENDAR_SCOPES,
        expiresAt: opts.expiresAt ?? null,
      })
      .where(eq(oauthConnections.id, existing.id));
    return existing.id;
  }

  const id = connectionId();
  await db.insert(oauthConnections).values({
    id,
    accountId: opts.accountId,
    provider: "google_calendar",
    accessTokenEnc,
    refreshTokenEnc,
    scopes: opts.scopes ?? CALENDAR_SCOPES,
    expiresAt: opts.expiresAt ?? null,
  });
  return id;
}

export async function hasGoogleCalendarConnection(accountId: string) {
  const [row] = await db
    .select({ id: oauthConnections.id })
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.accountId, accountId),
        eq(oauthConnections.provider, "google_calendar"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function disconnectGoogleCalendar(accountId: string) {
  await db
    .delete(oauthConnections)
    .where(
      and(
        eq(oauthConnections.accountId, accountId),
        eq(oauthConnections.provider, "google_calendar"),
      ),
    );
}

async function getAccessToken(accountId: string): Promise<string | null> {
  const key = encryptionKey();
  if (!key) return null;

  const [row] = await db
    .select()
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.accountId, accountId),
        eq(oauthConnections.provider, "google_calendar"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const expired =
    row.expiresAt && row.expiresAt.getTime() < Date.now() + 60_000;
  if (!expired) {
    return decryptSecret(row.accessTokenEnc, key);
  }

  if (!row.refreshTokenEnc || !env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    return decryptSecret(row.accessTokenEnc, key);
  }

  const refreshToken = decryptSecret(row.refreshTokenEnc, key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.AUTH_GOOGLE_ID,
      client_secret: env.AUTH_GOOGLE_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.warn("[calendar] refresh failed:", await res.text());
    return decryptSecret(row.accessTokenEnc, key);
  }
  const body = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const expiresAt = body.expires_in
    ? new Date(Date.now() + body.expires_in * 1000)
    : null;
  await upsertGoogleCalendarTokens({
    accountId,
    accessToken: body.access_token,
    refreshToken,
    expiresAt,
  });
  return body.access_token;
}

function eventBodyFromPlan(plan: WorkPlanRow) {
  const start = plan.nextDueAt ?? plan.startsAt;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    summary: `Manycat Work plan`,
    description: plan.promptTemplate.slice(0, 2000) || "Scheduled Work session",
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/** Best-effort write-only mirror. Never throws to callers that soft-catch. */
export async function mirrorPlanToCalendar(plan: WorkPlanRow): Promise<void> {
  const token = await getAccessToken(plan.accountId);
  if (!token) return;

  const body = eventBodyFromPlan(plan);
  if (plan.googleEventId) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(plan.googleEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return;
    // Fall through to create if update failed (deleted externally).
  }

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.warn("[calendar] create failed:", await res.text());
    return;
  }
  const created = (await res.json()) as { id?: string };
  if (created.id) {
    const { workPlans: wp } = await import("@/server/db/schema");
    await db
      .update(wp)
      .set({ googleEventId: created.id })
      .where(eq(wp.id, plan.id));
  }
}

export async function removeCalendarMirror(plan: WorkPlanRow): Promise<void> {
  if (!plan.googleEventId) return;
  const token = await getAccessToken(plan.accountId);
  if (!token) return;

  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(plan.googleEventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  ).catch(() => undefined);

  const { workPlans: wp } = await import("@/server/db/schema");
  await db
    .update(wp)
    .set({ googleEventId: null })
    .where(eq(wp.id, plan.id));
}

export async function exchangeGoogleCalendarCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string;
}> {
  if (!googleCalendarConfigured()) {
    throw new Error("Google Calendar OAuth is not configured");
  }
  const redirectUri = `${env.AUTH_URL}/api/integrations/google-calendar/callback`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.AUTH_GOOGLE_ID!,
      client_secret: env.AUTH_GOOGLE_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000)
      : undefined,
    scopes: body.scope,
  };
}
