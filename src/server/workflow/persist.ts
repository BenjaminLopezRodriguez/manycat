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
}
