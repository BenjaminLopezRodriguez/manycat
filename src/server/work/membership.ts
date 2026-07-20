import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "@/server/db";
import {
  projects,
  workJoinTokens,
  workSessionMembers,
  workflowMessages,
} from "@/server/db/schema";
import type { PersistedMsg } from "@/server/workflow/persist";

export async function ensureOwnerMembership(opts: {
  workflowId: string;
  ownerAccountId: string;
}) {
  await db
    .insert(workSessionMembers)
    .values({
      workflowId: opts.workflowId,
      ownerAccountId: opts.ownerAccountId,
      accountId: opts.ownerAccountId,
      role: "owner",
    })
    .onConflictDoNothing();
}

export async function getMembership(opts: {
  workflowId: string;
  accountId: string;
}) {
  const [row] = await db
    .select()
    .from(workSessionMembers)
    .where(
      and(
        eq(workSessionMembers.workflowId, opts.workflowId),
        eq(workSessionMembers.accountId, opts.accountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function assertWorkAccess(opts: {
  workflowId: string;
  accountId: string;
}): Promise<{ ownerAccountId: string; role: "owner" | "member" }> {
  const membership = await getMembership(opts);
  if (membership) {
    return {
      ownerAccountId: membership.ownerAccountId,
      role: membership.role,
    };
  }

  // Owner may not have been backfilled yet — projects row is enough.
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
        eq(projects.githubRepo, "workspace"),
      ),
    )
    .limit(1);

  if (owned) {
    await ensureOwnerMembership({
      workflowId: opts.workflowId,
      ownerAccountId: opts.accountId,
    });
    return { ownerAccountId: opts.accountId, role: "owner" };
  }

  throw new Error("Not a member of this Work chat");
}

export async function createJoinToken(opts: {
  workflowId: string;
  ownerAccountId: string;
  createdBy: string;
  expiresAt?: Date | null;
}): Promise<string> {
  await assertWorkAccess({
    workflowId: opts.workflowId,
    accountId: opts.createdBy,
  });
  const token = randomBytes(24).toString("base64url");
  await db.insert(workJoinTokens).values({
    token,
    workflowId: opts.workflowId,
    ownerAccountId: opts.ownerAccountId,
    createdBy: opts.createdBy,
    expiresAt: opts.expiresAt ?? null,
  });
  return token;
}

export async function resolveJoinToken(token: string) {
  const [row] = await db
    .select()
    .from(workJoinTokens)
    .where(eq(workJoinTokens.token, token))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function joinWithToken(opts: {
  token: string;
  accountId: string;
}): Promise<{ workflowId: string; ownerAccountId: string }> {
  const row = await resolveJoinToken(opts.token);
  if (!row) throw new Error("Invalid or expired join link");

  await db
    .insert(workSessionMembers)
    .values({
      workflowId: row.workflowId,
      ownerAccountId: row.ownerAccountId,
      accountId: opts.accountId,
      role: opts.accountId === row.ownerAccountId ? "owner" : "member",
    })
    .onConflictDoNothing();

  return {
    workflowId: row.workflowId,
    ownerAccountId: row.ownerAccountId,
  };
}

export async function listSharedWorkSessions(accountId: string) {
  const memberRows = await db
    .select({
      workflowId: workSessionMembers.workflowId,
      ownerAccountId: workSessionMembers.ownerAccountId,
      role: workSessionMembers.role,
    })
    .from(workSessionMembers)
    .where(eq(workSessionMembers.accountId, accountId));

  if (memberRows.length === 0) return [];

  const sessions = [];
  for (const m of memberRows) {
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.accountId, m.ownerAccountId),
          eq(projects.id, m.workflowId),
        ),
      )
      .limit(1);
    if (!project) continue;

    const msgs = await db
      .select({ payload: workflowMessages.payload })
      .from(workflowMessages)
      .where(
        and(
          eq(workflowMessages.accountId, m.ownerAccountId),
          eq(workflowMessages.workflowId, m.workflowId),
        ),
      )
      .orderBy(asc(workflowMessages.seq));

    sessions.push({
      id: project.id,
      name: project.name,
      githubRepo: project.githubRepo,
      contentBackend: project.contentBackend,
      status: project.status ?? "idle",
      agentJobId: project.agentJobId ?? null,
      lastRunOutcome: project.lastRunOutcome ?? null,
      unread: project.unread ?? 0,
      messages: msgs.map((r) => r.payload as PersistedMsg),
      files: [] as { path: string; contents: string }[],
      ownerAccountId: m.ownerAccountId,
      memberRole: m.role,
      shared: m.ownerAccountId !== accountId,
    });
  }
  return sessions;
}

export async function getActiveJoinUrl(opts: {
  workflowId: string;
  ownerAccountId: string;
  createdBy: string;
  origin: string;
}): Promise<string> {
  const [existing] = await db
    .select()
    .from(workJoinTokens)
    .where(
      and(
        eq(workJoinTokens.workflowId, opts.workflowId),
        eq(workJoinTokens.ownerAccountId, opts.ownerAccountId),
        isNull(workJoinTokens.revokedAt),
        or(
          isNull(workJoinTokens.expiresAt),
          sql`${workJoinTokens.expiresAt} > now()`,
        ),
      ),
    )
    .limit(1);

  const token =
    existing?.token ??
    (await createJoinToken({
      workflowId: opts.workflowId,
      ownerAccountId: opts.ownerAccountId,
      createdBy: opts.createdBy,
    }));

  return `${opts.origin}/c/${opts.workflowId}?join=${token}`;
}
