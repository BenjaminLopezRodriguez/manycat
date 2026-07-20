import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { ensureAccount } from "@/server/billing/budget";
import {
  createJoinToken,
  getActiveJoinUrl,
  joinWithToken,
  listSharedWorkSessions,
  assertWorkAccess,
  ensureOwnerMembership,
} from "@/server/work/membership";
import {
  buildPlaceholderPlanSteps,
  generatePlanSteps,
} from "@/server/work/plan-steps";
import {
  createWorkPlan,
  generateAgenda,
  listWorkPlans,
  pauseWorkPlan,
  updateWorkPlan,
} from "@/server/work/plans";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { workPlans } from "@/server/db/schema";
import {
  extractAndStoreNotes,
  listIntelligenceChips,
  markNoteUsed,
} from "@/server/work/notes";
import {
  disconnectGoogleCalendar,
  googleCalendarAuthUrl,
  googleCalendarConfigured,
  hasGoogleCalendarConnection,
} from "@/server/work/calendar";
import { ensurePersistenceSchema, ensureShellProject } from "@/server/workflow/persist";
import { env } from "@/env";
import { createHash, randomBytes } from "node:crypto";

const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("weekdays") }),
  z.object({
    kind: z.literal("interval"),
    hours: z.number().int().min(1).max(168),
  }),
]);

function oauthState(accountId: string) {
  const nonce = randomBytes(8).toString("hex");
  const payload = `${accountId}:${nonce}`;
  const sig = createHash("sha256")
    .update(`${payload}:${env.AUTH_SECRET ?? "dev"}`)
    .digest("hex")
    .slice(0, 16);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export const workRouter = createTRPCRouter({
  listPlans: protectedProcedure
    .input(
      z
        .object({
          workflowId: z.string().min(1).max(64).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      return listWorkPlans({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
      });
    }),

  createPlan: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1).max(64),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        cadence: cadenceSchema,
        timezone: z.string().min(1).max(64).default("UTC"),
        /** Goal the timeframe is for — LLM reasons around this + the window. */
        goal: z.string().min(1).max(4000).optional(),
        /** @deprecated prefer `goal` */
        promptTemplate: z.string().max(8000).optional(),
        /** Recent Work chat so the planner can ground prompts. */
        conversationContext: z.string().max(12_000).optional(),
        notify: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      await ensurePersistenceSchema();
      const fromGoal = input.goal?.trim();
      const fromTemplate = input.promptTemplate?.trim();
      const goalText =
        fromGoal && fromGoal.length > 0
          ? fromGoal
          : fromTemplate && fromTemplate.length > 0
            ? fromTemplate
            : "Stay on track with ongoing work.";
      await ensureShellProject({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        mode: "workspace",
        name: goalText.slice(0, 48) || "Work plan",
        status: "idle",
      });
      await ensureOwnerMembership({
        workflowId: input.workflowId,
        ownerAccountId: ctx.accountId,
      });

      // Persist the timeframe immediately — do not block on LLM.
      const placeholders = buildPlaceholderPlanSteps({
        goalHint: goalText,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cadence: input.cadence,
        timeZone: input.timezone,
      });

      const plan = await createWorkPlan({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cadence: input.cadence,
        timezone: input.timezone,
        promptTemplate: `Timed goal prompt: ${goalText}`,
        notify: input.notify,
        steps: placeholders.steps,
      });

      return {
        ...plan,
        goal: goalText,
        reasoning: placeholders.reasoning,
        scheduleSlots: placeholders.steps,
        pendingRefine: true as const,
      };
    }),

  /** LLM-refine timed prompts after the timeframe is already set. */
  refinePlanSteps: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1).max(64),
        goal: z.string().min(1).max(4000).optional(),
        conversationContext: z.string().max(12_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      const [plan] = await db
        .select()
        .from(workPlans)
        .where(
          and(
            eq(workPlans.id, input.planId),
            eq(workPlans.accountId, ctx.accountId),
          ),
        )
        .limit(1);
      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      const fromGoal = input.goal?.trim();
      const fromTemplate = plan.promptTemplate?.trim();
      const goalText =
        fromGoal && fromGoal.length > 0
          ? fromGoal
          : fromTemplate && fromTemplate.length > 0
            ? fromTemplate
            : "Stay on track with ongoing work.";

      const planned = await generatePlanSteps({
        accountId: ctx.accountId,
        workflowId: plan.workflowId,
        goalHint: goalText,
        conversationContext: input.conversationContext,
        startsAt: plan.startsAt,
        endsAt: plan.endsAt,
        cadence: plan.cadence,
        timeZone: plan.timezone,
      });

      await updateWorkPlan({
        planId: plan.id,
        accountId: ctx.accountId,
        patch: {
          promptTemplate: planned.promptTemplate,
          steps: planned.steps,
        },
      });

      return {
        planId: plan.id,
        goal: goalText,
        reasoning: planned.reasoning,
        scheduleSlots: planned.steps,
      };
    }),

  updatePlan: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1).max(64),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        cadence: cadenceSchema.optional(),
        timezone: z.string().min(1).max(64).optional(),
        promptTemplate: z.string().max(8000).optional(),
        status: z.enum(["active", "paused", "ended"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      const { planId, ...patch } = input;
      return updateWorkPlan({
        planId,
        accountId: ctx.accountId,
        patch,
      });
    }),

  pausePlan: protectedProcedure
    .input(z.object({ planId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      return pauseWorkPlan({
        planId: input.planId,
        accountId: ctx.accountId,
      });
    }),

  generateAgenda: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1).max(64),
        goalHint: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      await ensurePersistenceSchema();
      await ensureShellProject({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        mode: "workspace",
        name: input.goalHint?.slice(0, 48) ?? "Work chat",
        status: "idle",
      });
      await ensureOwnerMembership({
        workflowId: input.workflowId,
        ownerAccountId: ctx.accountId,
      });
      const agenda = await generateAgenda({
        accountId: ctx.accountId,
        workflowId: input.workflowId,
        goalHint: input.goalHint,
      });
      return { agenda };
    }),

  listChips: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      await assertWorkAccess({
        workflowId: input.workflowId,
        accountId: ctx.accountId,
      });
      return listIntelligenceChips({ workflowId: input.workflowId });
    }),

  markChipUsed: protectedProcedure
    .input(
      z.object({
        noteId: z.string().min(1).max(64),
        planId: z.string().min(1).max(64),
        workflowId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      await assertWorkAccess({
        workflowId: input.workflowId,
        accountId: ctx.accountId,
      });
      await markNoteUsed({
        noteId: input.noteId,
        planId: input.planId,
        accountId: ctx.accountId,
      });
      return { ok: true as const };
    }),

  extractNotes: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1).max(64),
        messageText: z.string().min(1).max(8000),
        authorLabel: z.string().max(128).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      const access = await assertWorkAccess({
        workflowId: input.workflowId,
        accountId: ctx.accountId,
      });
      const count = await extractAndStoreNotes({
        workflowId: input.workflowId,
        ownerAccountId: access.ownerAccountId,
        messageText: input.messageText,
        authorAccountId: ctx.accountId,
        authorLabel: input.authorLabel ?? ctx.accountId,
      });
      return { count };
    }),

  createJoinLink: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      const access = await assertWorkAccess({
        workflowId: input.workflowId,
        accountId: ctx.accountId,
      });
      if (access.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can create join links",
        });
      }
      const origin = env.AUTH_URL ?? "http://localhost:3000";
      const url = await getActiveJoinUrl({
        workflowId: input.workflowId,
        ownerAccountId: access.ownerAccountId,
        createdBy: ctx.accountId,
        origin,
      });
      return { url };
    }),

  joinSession: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await ensureAccount(ctx.accountId);
      await ensurePersistenceSchema();
      try {
        return await joinWithToken({
          token: input.token,
          accountId: ctx.accountId,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Join failed",
        });
      }
    }),

  listSharedSessions: protectedProcedure.query(async ({ ctx }) => {
    await ensurePersistenceSchema();
    return listSharedWorkSessions(ctx.accountId);
  }),

  calendarStatus: protectedProcedure.query(async ({ ctx }) => {
    await ensurePersistenceSchema();
    return {
      configured: googleCalendarConfigured(),
      connected: await hasGoogleCalendarConnection(ctx.accountId),
    };
  }),

  calendarConnectUrl: protectedProcedure.query(({ ctx }) => {
    if (!googleCalendarConfigured()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Google Calendar OAuth is not configured",
      });
    }
    const state = oauthState(ctx.accountId);
    return { url: googleCalendarAuthUrl({ accountId: ctx.accountId, state }) };
  }),

  calendarDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ensurePersistenceSchema();
    await disconnectGoogleCalendar(ctx.accountId);
    return { ok: true as const };
  }),

  /** Exposed for share menu — mint token without needing AUTH_URL origin. */
  mintJoinToken: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await ensurePersistenceSchema();
      const access = await assertWorkAccess({
        workflowId: input.workflowId,
        accountId: ctx.accountId,
      });
      if (access.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can share",
        });
      }
      const token = await createJoinToken({
        workflowId: input.workflowId,
        ownerAccountId: access.ownerAccountId,
        createdBy: ctx.accountId,
      });
      return { token, workflowId: input.workflowId };
    }),
});
