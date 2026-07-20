import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";
import { db } from "@/server/db";
import {
  projects,
  workPlanOccurrences,
  type workPlans,
} from "@/server/db/schema";
import {
  advancePlanAfterFire,
  listDuePlans,
} from "@/server/work/plans";
import { sendWorkPlanDueEmail } from "@/server/work/email";
import { isWithinPlanWindow } from "@/server/work/cadence";
import { extractAndStoreNotes } from "@/server/work/notes";
import {
  appendWorkflowMessages,
  type PersistedMsg,
} from "@/server/workflow/persist";

type WorkPlanRow = typeof workPlans.$inferSelect;

function occurrenceId() {
  return `wo_${randomBytes(12).toString("hex")}`;
}

function msgId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

async function fireOnePlan(plan: WorkPlanRow, now: Date) {
  if (
    !plan.nextDueAt ||
    !isWithinPlanWindow({
      at: plan.nextDueAt,
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
    })
  ) {
    await advancePlanAfterFire({ planId: plan.id, firedAt: now });
    return { planId: plan.id, status: "skipped" as const };
  }

  // Idempotency: skip if we already fired for this dueAt.
  const [existing] = await db
    .select({ id: workPlanOccurrences.id })
    .from(workPlanOccurrences)
    .where(
      and(
        eq(workPlanOccurrences.planId, plan.id),
        eq(workPlanOccurrences.dueAt, plan.nextDueAt),
      ),
    )
    .limit(1);
  if (existing) {
    await advancePlanAfterFire({ planId: plan.id, firedAt: plan.nextDueAt });
    return { planId: plan.id, status: "skipped" as const };
  }

  const occId = occurrenceId();
  await db.insert(workPlanOccurrences).values({
    id: occId,
    planId: plan.id,
    dueAt: plan.nextDueAt,
    status: "running",
    firedAt: now,
  });

  const prompt =
    plan.promptTemplate.trim() ||
    "Timed goal prompt: what should we push forward next?";

  const userMsg: PersistedMsg = {
    id: msgId(),
    type: "text",
    role: "user",
    text: prompt,
    meta: { scheduledPlanId: plan.id, occurrenceId: occId },
  };

  let assistantText =
    "I'm ready for this scheduled session. What would you like to tackle?";
  try {
    assistantText = await runChatCompletion([
      {
        role: "system",
        content:
          "You are Manycat's workplace assistant running a scheduled Work session. " +
          "Be concise and actionable. The user is in the loop.",
      } satisfies ChatMessage,
      { role: "user", content: prompt },
    ]);
  } catch (err) {
    console.warn(
      "[work-plans cron] runChat failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const assistantMsg: PersistedMsg = {
    id: msgId() + 1,
    type: "text",
    role: "assistant",
    text: assistantText,
    meta: { scheduledPlanId: plan.id, occurrenceId: occId },
  };

  await appendWorkflowMessages({
    accountId: plan.accountId,
    workflowId: plan.workflowId,
    messages: [userMsg, assistantMsg],
  });

  await db
    .update(projects)
    .set({ unread: 1, status: "needs-review" })
    .where(
      and(
        eq(projects.accountId, plan.accountId),
        eq(projects.id, plan.workflowId),
      ),
    );

  await db
    .update(workPlanOccurrences)
    .set({ status: "done", firedAt: now })
    .where(eq(workPlanOccurrences.id, occId));

  void extractAndStoreNotes({
    workflowId: plan.workflowId,
    ownerAccountId: plan.accountId,
    messageText: `${prompt}\n${assistantText}`,
    authorLabel: "Manycat",
  }).catch(() => undefined);

  // Email if notify enabled and account id looks like an email.
  if (plan.notify !== false && plan.accountId.includes("@")) {
    void sendWorkPlanDueEmail({
      to: plan.accountId,
      planId: plan.id,
      workflowId: plan.workflowId,
      preview: prompt,
    }).catch((err) => {
      console.warn(
        "[work-plans cron] email:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  await advancePlanAfterFire({ planId: plan.id, firedAt: plan.nextDueAt });

  return { planId: plan.id, status: "done" as const, occurrenceId: occId };
}

export async function tickWorkPlans(now = new Date()) {
  const due = await listDuePlans(now);
  const results = [];
  for (const plan of due) {
    try {
      results.push(await fireOnePlan(plan, now));
    } catch (err) {
      console.warn(
        "[work-plans cron] fire failed:",
        plan.id,
        err instanceof Error ? err.message : err,
      );
      results.push({ planId: plan.id, status: "error" as const });
    }
  }
  return { fired: results.length, results };
}
