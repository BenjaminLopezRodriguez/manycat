import { and, desc, eq, lte } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { isChatModelConfigured, runChatCompletion } from "@/server/ai/modal-chat";
import { db } from "@/server/db";
import {
  workPlans,
  type WorkPlanCadence,
  type WorkPlanStatus,
} from "@/server/db/schema";
import {
  computeInitialNextDueAt,
  computeNextDueAfterFire,
} from "@/server/work/cadence";
import { mirrorPlanToCalendar, removeCalendarMirror } from "@/server/work/calendar";
import { ensureOwnerMembership } from "@/server/work/membership";
import { notesForAgenda } from "@/server/work/notes";

function planId() {
  return `wp_${randomBytes(12).toString("hex")}`;
}

export type CreateWorkPlanInput = {
  accountId: string;
  workflowId: string;
  startsAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
  timezone?: string;
  promptTemplate?: string;
  notify?: boolean;
  steps?: { at: string; label: string; prompt: string }[];
};

export async function createWorkPlan(input: CreateWorkPlanInput) {
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new Error("endsAt must be after startsAt");
  }

  await ensureOwnerMembership({
    workflowId: input.workflowId,
    ownerAccountId: input.accountId,
  });

  const nextDueAt = computeInitialNextDueAt({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    cadence: input.cadence,
  });

  const id = planId();
  const promptTemplate = input.promptTemplate?.trim() ?? "";

  await db.insert(workPlans).values({
    id,
    accountId: input.accountId,
    workflowId: input.workflowId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    cadence: input.cadence,
    timezone: input.timezone ?? "UTC",
    promptTemplate,
    steps: input.steps,
    status: nextDueAt ? "active" : "ended",
    nextDueAt,
    notify: input.notify ?? true,
  });

  const [plan] = await db
    .select()
    .from(workPlans)
    .where(eq(workPlans.id, id))
    .limit(1);

  if (plan) {
    void mirrorPlanToCalendar(plan).catch((err) => {
      console.warn(
        "[createWorkPlan] calendar mirror:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  return plan!;
}

export async function updateWorkPlan(opts: {
  planId: string;
  accountId: string;
  patch: {
    startsAt?: Date;
    endsAt?: Date;
    cadence?: WorkPlanCadence;
    timezone?: string;
    promptTemplate?: string;
    status?: WorkPlanStatus;
  };
}) {
  const [existing] = await db
    .select()
    .from(workPlans)
    .where(
      and(eq(workPlans.id, opts.planId), eq(workPlans.accountId, opts.accountId)),
    )
    .limit(1);
  if (!existing) throw new Error("Plan not found");

  const startsAt = opts.patch.startsAt ?? existing.startsAt;
  const endsAt = opts.patch.endsAt ?? existing.endsAt;
  const cadence = opts.patch.cadence ?? existing.cadence;
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("endsAt must be after startsAt");
  }

  let nextDueAt = existing.nextDueAt;
  let status = opts.patch.status ?? existing.status;
  if (
    opts.patch.startsAt ||
    opts.patch.endsAt ||
    opts.patch.cadence ||
    opts.patch.status === "active"
  ) {
    nextDueAt = computeInitialNextDueAt({ startsAt, endsAt, cadence });
    if (!nextDueAt) status = "ended";
    else if (status === "ended" && opts.patch.status !== "ended") {
      status = "active";
    }
  }

  await db
    .update(workPlans)
    .set({
      startsAt,
      endsAt,
      cadence,
      timezone: opts.patch.timezone ?? existing.timezone,
      promptTemplate:
        opts.patch.promptTemplate ?? existing.promptTemplate,
      status,
      nextDueAt,
    })
    .where(eq(workPlans.id, opts.planId));

  const [plan] = await db
    .select()
    .from(workPlans)
    .where(eq(workPlans.id, opts.planId))
    .limit(1);

  if (plan) {
    if (plan.status === "ended" || plan.status === "paused") {
      void removeCalendarMirror(plan).catch(() => undefined);
    } else {
      void mirrorPlanToCalendar(plan).catch((err) => {
        console.warn(
          "[updateWorkPlan] calendar mirror:",
          err instanceof Error ? err.message : err,
        );
      });
    }
  }

  return plan!;
}

export async function listWorkPlans(opts: {
  accountId: string;
  workflowId?: string;
}) {
  const conditions = [eq(workPlans.accountId, opts.accountId)];
  if (opts.workflowId) {
    conditions.push(eq(workPlans.workflowId, opts.workflowId));
  }
  return db
    .select()
    .from(workPlans)
    .where(and(...conditions))
    .orderBy(desc(workPlans.createdAt));
}

export async function pauseWorkPlan(opts: {
  planId: string;
  accountId: string;
}) {
  return updateWorkPlan({
    planId: opts.planId,
    accountId: opts.accountId,
    patch: { status: "paused" },
  });
}

export async function generateAgenda(opts: {
  accountId: string;
  workflowId: string;
  goalHint?: string;
}): Promise<string> {
  const notes = await notesForAgenda({ workflowId: opts.workflowId });
  const hint = opts.goalHint?.trim() ?? "Stay on track with ongoing work.";

  if (!isChatModelConfigured()) {
    const noteBlock =
      notes.length > 0
        ? `\n\nContext notes:\n${notes.map((n) => `- ${n}`).join("\n")}`
        : "";
    return `Timed goal prompt: ${hint}${noteBlock}\n\nWhat progress did we make, and what's the next concrete step?`;
  }

  const reply = await runChatCompletion([
    {
      role: "system",
      content:
          "Write a short timed work prompt (2-6 sentences) for a goal timeframe. " +
          "It will fire on a schedule inside the window — the model is not running continuously. " +
          "Incorporate relevant notes. Return only the prompt text.",
    },
    {
      role: "user",
      content: [
        `Goal: ${hint}`,
        notes.length > 0
          ? `Notes:\n${notes.map((n) => `- ${n}`).join("\n")}`
          : "Notes: (none yet)",
      ].join("\n\n"),
    },
  ]);
  return reply.trim();
}

export async function listDuePlans(now = new Date()) {
  return db
    .select()
    .from(workPlans)
    .where(
      and(
        eq(workPlans.status, "active"),
        lte(workPlans.nextDueAt, now),
      ),
    )
    .limit(50);
}

export async function advancePlanAfterFire(opts: {
  planId: string;
  firedAt: Date;
}) {
  const [plan] = await db
    .select()
    .from(workPlans)
    .where(eq(workPlans.id, opts.planId))
    .limit(1);
  if (!plan) return null;

  const nextDueAt = computeNextDueAfterFire({
    firedAt: opts.firedAt,
    endsAt: plan.endsAt,
    cadence: plan.cadence,
  });

  await db
    .update(workPlans)
    .set({
      nextDueAt,
      status: nextDueAt ? "active" : "ended",
    })
    .where(eq(workPlans.id, opts.planId));

  const [updated] = await db
    .select()
    .from(workPlans)
    .where(eq(workPlans.id, opts.planId))
    .limit(1);

  if (updated?.status === "ended") {
    void removeCalendarMirror(updated).catch(() => undefined);
  } else if (updated) {
    void mirrorPlanToCalendar(updated).catch(() => undefined);
  }

  return updated;
}
