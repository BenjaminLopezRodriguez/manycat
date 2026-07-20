import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { isChatModelConfigured, runChatCompletion } from "@/server/ai/modal-chat";
import { db } from "@/server/db";
import { workNotes } from "@/server/db/schema";

function noteId() {
  return `wn_${randomBytes(12).toString("hex")}`;
}

/** Heuristic extraction — catches concrete tips / preferences without an LLM. */
export function extractNotesHeuristic(opts: {
  text: string;
  authorAccountId?: string | null;
  authorLabel?: string | null;
}): { text: string; summary: string }[] {
  const lines = opts.text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && l.length <= 400);

  const interesting = lines.filter((l) =>
    /\b(want|wants|prefer|likes?|remind|remember|meeting|deal|client|try|japanese|lunch|dinner|follow[- ]?up|deadline|budget)\b/i.test(
      l,
    ),
  );

  const picked = (interesting.length > 0 ? interesting : lines).slice(0, 3);
  return picked.map((text) => ({
    text,
    summary: text.length > 80 ? `${text.slice(0, 77)}…` : text,
  }));
}

export async function extractAndStoreNotes(opts: {
  workflowId: string;
  ownerAccountId: string;
  messageText: string;
  sourceMessageId?: string;
  authorAccountId?: string | null;
  authorLabel?: string | null;
}): Promise<number> {
  let candidates = extractNotesHeuristic({
    text: opts.messageText,
    authorAccountId: opts.authorAccountId,
    authorLabel: opts.authorLabel,
  });

  if (isChatModelConfigured() && opts.messageText.length > 40) {
    try {
      const raw = await runChatCompletion([
        {
          role: "system",
          content:
            "Extract 0-3 short actionable work notes from the message. " +
            "Return JSON array of {\"text\",\"summary\"} only. Empty array if none.",
        },
        { role: "user", content: opts.messageText.slice(0, 2000) },
      ]);
      const match = /\[[\s\S]*\]/.exec(raw);
      if (match) {
        const parsed = JSON.parse(match[0]) as {
          text?: string;
          summary?: string;
        }[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          candidates = parsed
            .filter((p) => typeof p.text === "string" && p.text.trim())
            .slice(0, 3)
            .map((p) => ({
              text: String(p.text).trim(),
              summary: String(p.summary ?? p.text)
                .trim()
                .slice(0, 512),
            }));
        }
      }
    } catch {
      // Keep heuristic candidates.
    }
  }

  if (candidates.length === 0) return 0;

  await db.insert(workNotes).values(
    candidates.map((c) => ({
      id: noteId(),
      workflowId: opts.workflowId,
      ownerAccountId: opts.ownerAccountId,
      sourceMessageId: opts.sourceMessageId,
      authorAccountId: opts.authorAccountId ?? null,
      authorLabel: opts.authorLabel?.slice(0, 128) ?? null,
      text: c.text,
      summary: c.summary.slice(0, 512),
    })),
  );
  return candidates.length;
}

export async function listIntelligenceChips(opts: {
  workflowId: string;
  limit?: number;
}) {
  const limit = opts.limit ?? 8;
  return db
    .select({
      id: workNotes.id,
      summary: workNotes.summary,
      text: workNotes.text,
      authorAccountId: workNotes.authorAccountId,
      authorLabel: workNotes.authorLabel,
      createdAt: workNotes.createdAt,
      usedInPlanId: workNotes.usedInPlanId,
    })
    .from(workNotes)
    .where(
      and(
        eq(workNotes.workflowId, opts.workflowId),
        isNull(workNotes.usedInPlanId),
      ),
    )
    .orderBy(desc(workNotes.createdAt))
    .limit(limit);
}

export async function markNoteUsed(opts: {
  noteId: string;
  planId: string;
  accountId: string;
}) {
  // Soft ACL: note must belong to a workflow the account can access —
  // caller should have already checked membership.
  await db
    .update(workNotes)
    .set({ usedInPlanId: opts.planId })
    .where(eq(workNotes.id, opts.noteId));
}

export async function notesForAgenda(opts: {
  workflowId: string;
  limit?: number;
}): Promise<string[]> {
  const rows = await db
    .select({ text: workNotes.text, summary: workNotes.summary })
    .from(workNotes)
    .where(eq(workNotes.workflowId, opts.workflowId))
    .orderBy(desc(workNotes.createdAt))
    .limit(opts.limit ?? 12);
  return rows.map((r) => r.summary || r.text);
}

/** Used by tests — count notes for a workflow. */
export async function countNotes(workflowId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workNotes)
    .where(eq(workNotes.workflowId, workflowId));
  return row?.n ?? 0;
}
