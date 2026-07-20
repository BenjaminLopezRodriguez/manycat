import { and, asc, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { db } from "@/server/db";
import {
  projects,
  workflowMessages,
  workspaceFiles,
} from "@/server/db/schema";
import { isS3Configured, signCreateImageUrl } from "@/server/s3/create-images";

export type PersistedMsg = Record<string, unknown> & {
  id: number;
  type: string;
};

function messageRowId(accountId: string, workflowId: string, seq: number) {
  return createHash("sha256")
    .update(`${accountId}:${workflowId}:${seq}`)
    .digest("hex")
    .slice(0, 32);
}

export async function listWorkspaceFiles(opts: {
  accountId: string;
  workflowId: string;
}): Promise<{ path: string; contents: string }[]> {
  const rows = await db
    .select({
      path: workspaceFiles.path,
      contents: workspaceFiles.contents,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.accountId, opts.accountId),
        eq(workspaceFiles.workflowId, opts.workflowId),
      ),
    );
  return rows;
}

export async function replaceWorkspaceFiles(opts: {
  accountId: string;
  workflowId: string;
  files: { path: string; contents: string }[];
}) {
  const { accountId, workflowId, files } = opts;
  await db
    .delete(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.accountId, accountId),
        eq(workspaceFiles.workflowId, workflowId),
      ),
    );

  if (files.length === 0) return;

  await db.insert(workspaceFiles).values(
    files.map((f) => ({
      accountId,
      workflowId,
      path: f.path.slice(0, 512),
      contents: f.contents,
      updatedAt: new Date(),
    })),
  );
}

export async function appendWorkflowMessages(opts: {
  accountId: string;
  workflowId: string;
  messages: PersistedMsg[];
}) {
  const { accountId, workflowId, messages } = opts;
  if (messages.length === 0) return;

  const existing = await db
    .select({ seq: workflowMessages.seq })
    .from(workflowMessages)
    .where(
      and(
        eq(workflowMessages.accountId, accountId),
        eq(workflowMessages.workflowId, workflowId),
      ),
    )
    .orderBy(asc(workflowMessages.seq));

  let nextSeq =
    existing.length > 0 ? (existing[existing.length - 1]?.seq ?? 0) + 1 : 0;

  await db.insert(workflowMessages).values(
    messages.map((payload) => {
      const seq = nextSeq++;
      return {
        id: messageRowId(accountId, workflowId, seq) + randomBytes(4).toString("hex"),
        accountId,
        workflowId,
        seq,
        payload,
      };
    }),
  );
}

/** Replace entire message history (used for initial create). */
export async function setWorkflowMessages(opts: {
  accountId: string;
  workflowId: string;
  messages: PersistedMsg[];
}) {
  const { accountId, workflowId, messages } = opts;
  await db
    .delete(workflowMessages)
    .where(
      and(
        eq(workflowMessages.accountId, accountId),
        eq(workflowMessages.workflowId, workflowId),
      ),
    );

  if (messages.length === 0) return;

  await db.insert(workflowMessages).values(
    messages.map((payload, seq) => ({
      id: messageRowId(accountId, workflowId, seq) + randomBytes(4).toString("hex"),
      accountId,
      workflowId,
      seq,
      payload,
    })),
  );
}

export async function setProjectStatus(opts: {
  accountId: string;
  workflowId: string;
  status: "idle" | "working" | "needs-review" | "done";
}) {
  await db
    .update(projects)
    .set({ status: opts.status })
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    );
}

export type LastRunOutcome = "ok" | "failed" | "budget" | null;

export async function setProjectAgentRun(opts: {
  accountId: string;
  workflowId: string;
  agentJobId?: string | null;
  lastRunOutcome?: LastRunOutcome;
  unread?: number;
  status?: "idle" | "working" | "needs-review" | "done";
  agentBilledPromptTokens?: number;
  agentBilledCompletionTokens?: number;
  clearBilledTokens?: boolean;
}) {
  const patch: Record<string, unknown> = {};
  if (opts.agentJobId !== undefined) patch.agentJobId = opts.agentJobId;
  if (opts.lastRunOutcome !== undefined)
    patch.lastRunOutcome = opts.lastRunOutcome;
  if (opts.unread !== undefined) patch.unread = opts.unread;
  if (opts.status !== undefined) patch.status = opts.status;
  if (opts.clearBilledTokens) {
    patch.agentBilledPromptTokens = 0;
    patch.agentBilledCompletionTokens = 0;
  } else {
    if (opts.agentBilledPromptTokens !== undefined) {
      patch.agentBilledPromptTokens = opts.agentBilledPromptTokens;
    }
    if (opts.agentBilledCompletionTokens !== undefined) {
      patch.agentBilledCompletionTokens = opts.agentBilledCompletionTokens;
    }
  }
  if (Object.keys(patch).length === 0) return;
  await db
    .update(projects)
    .set(patch)
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    );
}

export async function clearProjectUnread(opts: {
  accountId: string;
  workflowId: string;
}) {
  await db
    .update(projects)
    .set({ unread: 0 })
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    );
}

export async function setProjectContentRoot(opts: {
  accountId: string;
  workflowId: string;
  contentRootHash: string;
}) {
  await db
    .update(projects)
    .set({ contentRootHash: opts.contentRootHash })
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    );
}

async function refreshImagePayload(payload: PersistedMsg): Promise<PersistedMsg> {
  if (payload.type !== "image") return payload;
  const key = typeof payload.s3Key === "string" ? payload.s3Key : null;
  if (!key || !isS3Configured()) return payload;
  try {
    const src = await signCreateImageUrl(key);
    return { ...payload, src };
  } catch {
    return payload;
  }
}

export async function listPersistedSessions(accountId: string) {
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      githubRepo: projects.githubRepo,
      contentBackend: projects.contentBackend,
      status: projects.status,
      agentJobId: projects.agentJobId,
      lastRunOutcome: projects.lastRunOutcome,
      unread: projects.unread,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.accountId, accountId))
    .orderBy(asc(projects.createdAt));

  if (projectRows.length === 0) return [];

  const messageRows = await db
    .select({
      workflowId: workflowMessages.workflowId,
      seq: workflowMessages.seq,
      payload: workflowMessages.payload,
    })
    .from(workflowMessages)
    .where(eq(workflowMessages.accountId, accountId))
    .orderBy(asc(workflowMessages.workflowId), asc(workflowMessages.seq));

  const fileRows = await db
    .select({
      workflowId: workspaceFiles.workflowId,
      path: workspaceFiles.path,
      contents: workspaceFiles.contents,
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.accountId, accountId));

  const messagesByWf = new Map<string, PersistedMsg[]>();
  for (const row of messageRows) {
    const list = messagesByWf.get(row.workflowId) ?? [];
    list.push(row.payload as PersistedMsg);
    messagesByWf.set(row.workflowId, list);
  }

  // Re-sign private Create image URLs so refresh still renders.
  if (isS3Configured()) {
    await Promise.all(
      [...messagesByWf.entries()].map(async ([wfId, msgs]) => {
        messagesByWf.set(
          wfId,
          await Promise.all(msgs.map((m) => refreshImagePayload(m))),
        );
      }),
    );
  }

  const filesByWf = new Map<string, { path: string; contents: string }[]>();
  for (const row of fileRows) {
    const list = filesByWf.get(row.workflowId) ?? [];
    list.push({ path: row.path, contents: row.contents });
    filesByWf.set(row.workflowId, list);
  }

  return projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    githubRepo: p.githubRepo,
    contentBackend: p.contentBackend,
    status: p.status ?? "idle",
    agentJobId: p.agentJobId ?? null,
    lastRunOutcome: p.lastRunOutcome ?? null,
    unread: p.unread ?? 0,
    messages: messagesByWf.get(p.id) ?? [],
    files: filesByWf.get(p.id) ?? [],
  }));
}

/** Upsert a Create / research / workspace shell session (control-plane row). */
export async function ensureShellProject(opts: {
  accountId: string;
  workflowId: string;
  mode: "create" | "research" | "workspace";
  name: string;
  status?: "idle" | "working" | "needs-review" | "done";
}) {
  const status = opts.status ?? "idle";
  await db
    .insert(projects)
    .values({
      id: opts.workflowId,
      accountId: opts.accountId,
      name: opts.name.slice(0, 256),
      githubRepo: opts.mode,
      contentBackend: "virtual",
      status,
    })
    .onConflictDoUpdate({
      target: [projects.accountId, projects.id],
      set: {
        name: opts.name.slice(0, 256),
        githubRepo: opts.mode,
        contentBackend: "virtual",
        status,
      },
    });
}

export async function deletePersistedSession(opts: {
  accountId: string;
  workflowId: string;
}) {
  const [row] = await db
    .select({
      railwayServiceId: projects.railwayServiceId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    )
    .limit(1);

  if (row?.railwayServiceId) {
    try {
      const { releaseToPool, recycleSlot } = await import(
        "@/server/railway/pool"
      );
      const { released } = await releaseToPool({
        accountId: opts.accountId,
        workflowId: opts.workflowId,
        serviceId: row.railwayServiceId,
      });
      if (released) {
        // Best-effort immediate recycle; cron will retry if this fails.
        void recycleSlot({ serviceId: row.railwayServiceId }).catch((err) => {
          console.warn(
            "[deletePersistedSession] recycleSlot:",
            err instanceof Error ? err.message : err,
          );
        });
      }
    } catch (err) {
      console.warn(
        "[deletePersistedSession] pool release:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await db
    .delete(projects)
    .where(
      and(
        eq(projects.accountId, opts.accountId),
        eq(projects.id, opts.workflowId),
      ),
    );
}

/** Ensure status column exists for older DBs that only ran partial migrations. */
export async function ensurePersistenceSchema() {
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "status" varchar(32) NOT NULL DEFAULT 'idle'
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "agentJobId" varchar(64)
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "lastRunOutcome" varchar(16)
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "unread" integer NOT NULL DEFAULT 0
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "agentBilledPromptTokens" integer NOT NULL DEFAULT 0
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "agentBilledCompletionTokens" integer NOT NULL DEFAULT 0
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_project" ADD COLUMN IF NOT EXISTS "contextPack" jsonb
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_railway_pool_slot" (
      "id" varchar(64) PRIMARY KEY,
      "railwayServiceId" varchar(128) NOT NULL,
      "railwayDomain" varchar(512),
      "status" varchar(32) NOT NULL DEFAULT 'hot',
      "accountId" varchar(128),
      "workflowId" varchar(64),
      "claimedAt" timestamptz,
      "lastHotAt" timestamptz,
      "generation" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "railway_pool_service_uidx"
      ON "manycat_railway_pool_slot" ("railwayServiceId")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "railway_pool_status_idx"
      ON "manycat_railway_pool_slot" ("status")
  `);

  // Work mode tables (plan-over-time, join links, intelligence, OAuth).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_work_plan" (
      "id" varchar(64) PRIMARY KEY,
      "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "workflowId" varchar(64) NOT NULL,
      "startsAt" timestamptz NOT NULL,
      "endsAt" timestamptz NOT NULL,
      "cadence" jsonb NOT NULL,
      "timezone" varchar(64) NOT NULL DEFAULT 'UTC',
      "promptTemplate" text NOT NULL DEFAULT '',
      "status" varchar(16) NOT NULL DEFAULT 'active',
      "nextDueAt" timestamptz,
      "googleEventId" varchar(256),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_plan_account_idx" ON "manycat_work_plan" ("accountId")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_plan_due_idx" ON "manycat_work_plan" ("status", "nextDueAt")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_plan_workflow_idx" ON "manycat_work_plan" ("accountId", "workflowId")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_work_plan_occurrence" (
      "id" varchar(64) PRIMARY KEY,
      "planId" varchar(64) NOT NULL REFERENCES "manycat_work_plan"("id") ON DELETE cascade,
      "dueAt" timestamptz NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'pending',
      "firedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_occurrence_plan_idx" ON "manycat_work_plan_occurrence" ("planId", "dueAt")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_work_session_member" (
      "workflowId" varchar(64) NOT NULL,
      "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "role" varchar(16) NOT NULL DEFAULT 'member',
      "joinedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("workflowId", "accountId")
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_member_account_idx" ON "manycat_work_session_member" ("accountId")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_work_join_token" (
      "token" varchar(64) PRIMARY KEY,
      "workflowId" varchar(64) NOT NULL,
      "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "createdBy" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "expiresAt" timestamptz,
      "revokedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_work_note" (
      "id" varchar(64) PRIMARY KEY,
      "workflowId" varchar(64) NOT NULL,
      "ownerAccountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "sourceMessageId" varchar(64),
      "authorAccountId" varchar(128),
      "authorLabel" varchar(128),
      "text" text NOT NULL,
      "summary" varchar(512) NOT NULL,
      "usedInPlanId" varchar(64),
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "work_note_workflow_idx" ON "manycat_work_note" ("workflowId", "createdAt")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "manycat_oauth_connection" (
      "id" varchar(64) PRIMARY KEY,
      "accountId" varchar(128) NOT NULL REFERENCES "manycat_account"("id") ON DELETE cascade,
      "provider" varchar(32) NOT NULL,
      "accessTokenEnc" text NOT NULL,
      "refreshTokenEnc" text,
      "scopes" text NOT NULL DEFAULT '',
      "expiresAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "oauth_connection_account_idx" ON "manycat_oauth_connection" ("accountId", "provider")
  `);
  await db.execute(sql`
    ALTER TABLE "manycat_work_plan" ADD COLUMN IF NOT EXISTS "notify" boolean NOT NULL DEFAULT true
  `);
}
