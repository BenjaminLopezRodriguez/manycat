import { isChatModelConfigured, runChatCompletion } from "@/server/ai/modal-chat";
import { notesForAgenda } from "@/server/work/notes";
import {
  expandScheduleSlots,
  type ScheduleSlot,
} from "@/server/work/schedule-preview";
import type { WorkPlanCadence } from "@/server/db/schema";

export type PlanStep = {
  /** When this prompt fires (ISO). */
  at: string;
  /** Display label e.g. "2:10pm Monday". */
  label: string;
  /** The prompt text that will run at that time. */
  prompt: string;
};

export type PlanStepPlan = {
  reasoning?: string;
  steps: PlanStep[];
  /** Fallback single template (first step / cron default). */
  promptTemplate: string;
};

export function coercePromptText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["prompt", "text", "content", "message"]) {
      const field = o[key];
      if (typeof field === "string") return field.trim();
    }
  }
  return "";
}

function formatInZone(at: Date, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    ...opts,
    timeZone: timeZone ?? undefined,
  }).format(at);
}

function describeCadence(cadence: WorkPlanCadence): string {
  if (cadence.kind === "daily") return "once per day";
  if (cadence.kind === "interval") {
    return cadence.hours === 1
      ? "every hour"
      : `every ${cadence.hours} hours`;
  }
  return "on a fixed schedule";
}

function describeWindow(opts: {
  startsAt: Date;
  endsAt: Date;
  timeZone?: string;
  cadence: WorkPlanCadence;
  slotCount: number;
}): string {
  const tz = opts.timeZone ?? "UTC";
  const hours = Math.max(
    1,
    Math.round((opts.endsAt.getTime() - opts.startsAt.getTime()) / 3_600_000),
  );
  const start = formatInZone(opts.startsAt, tz, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const end = formatInZone(opts.endsAt, tz, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return [
    `Window: ${hours}h (${start} → ${end}, ${tz})`,
    `Cadence: ${describeCadence(opts.cadence)} → ${opts.slotCount} timed prompts`,
  ].join("\n");
}

/**
 * Instant schedule for a goal window (no LLM) — persists the timeframe immediately.
 */
export function buildPlaceholderPlanSteps(opts: {
  goalHint?: string;
  startsAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
  timeZone?: string;
}): PlanStepPlan {
  const slots = expandScheduleSlots({
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    cadence: opts.cadence,
    timeZone: opts.timeZone,
  });
  const trimmedHint = opts.goalHint?.trim();
  const hint =
    trimmedHint && trimmedHint.length > 0
      ? trimmedHint
      : "Stay on track with ongoing work.";
  if (slots.length === 0) {
    return {
      promptTemplate: `Timed goal prompt: ${hint}`,
      steps: [],
      reasoning: `Goal timeframe set for: ${hint}`,
    };
  }
  const windowSummary = describeWindow({
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    timeZone: opts.timeZone,
    cadence: opts.cadence,
    slotCount: slots.length,
  });
  const generated = inventStepPromptsFallback({
    goal: hint,
    slots,
    windowSummary,
  });
  const steps: PlanStep[] = slots.map((slot, i) => ({
    at: slot.at.toISOString(),
    label: slot.label,
    prompt: generated.prompts[i] ?? `Progress check on: ${hint}`,
  }));
  return {
    reasoning: generated.reasoning,
    steps,
    promptTemplate: steps[0]?.prompt ?? `Timed goal prompt: ${hint}`,
  };
}

/**
 * Build timed prompt cards for a goal window — one distinct prompt per fire slot.
 * The LLM reasons about the timeframe + goal, then authors each autonomous prompt.
 */
export async function generatePlanSteps(opts: {
  accountId: string;
  workflowId: string;
  goalHint?: string;
  /** Recent Work chat / notes for richer planning. */
  conversationContext?: string;
  startsAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
  timeZone?: string;
}): Promise<PlanStepPlan> {
  const slots = expandScheduleSlots({
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    cadence: opts.cadence,
    timeZone: opts.timeZone,
  });
  const trimmedHint = opts.goalHint?.trim();
  const hint =
    trimmedHint && trimmedHint.length > 0
      ? trimmedHint
      : "Stay on track with ongoing work.";
  const notes = await notesForAgenda({ workflowId: opts.workflowId });

  if (slots.length === 0) {
    return {
      promptTemplate: `Timed goal prompt: ${hint}`,
      steps: [],
      reasoning: undefined,
    };
  }

  const windowSummary = describeWindow({
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    timeZone: opts.timeZone,
    cadence: opts.cadence,
    slotCount: slots.length,
  });

  const generated = await inventStepPrompts({
    goal: hint,
    notes,
    slots,
    windowSummary,
    conversationContext: opts.conversationContext,
  });

  const steps: PlanStep[] = slots.map((slot, i) => {
    const fromGen =
      generated.prompts[i]?.trim() ?? generated.prompts[0]?.trim();
    return {
      at: slot.at.toISOString(),
      label: slot.label,
      prompt:
        fromGen && fromGen.length > 0
          ? fromGen
          : `Progress check on: ${hint}`,
    };
  });

  return {
    reasoning: generated.reasoning,
    steps,
    promptTemplate: steps[0]?.prompt ?? `Timed goal prompt: ${hint}`,
  };
}

async function inventStepPrompts(opts: {
  goal: string;
  notes: string[];
  slots: ScheduleSlot[];
  windowSummary: string;
  conversationContext?: string;
}): Promise<{ reasoning?: string; prompts: string[] }> {
  const n = opts.slots.length;
  const slotLines = opts.slots
    .map((s, i) => `${i + 1}. ${s.label} (${s.at.toISOString()})`)
    .join("\n");

  if (!isChatModelConfigured()) {
    return inventStepPromptsFallback(opts);
  }

  const raw = await runChatCompletion([
    {
      role: "system",
      content:
        "You are Manycat's Work planner. The user set a goal timeframe — the model is NOT " +
        "running continuously. You must (1) reason about how to use THIS window to advance the goal, " +
        "then (2) write one autonomous prompt per fire time.\n\n" +
        "Each prompt is the exact instruction the agent will run alone at that time — " +
        "actionable, specific to the goal, and appropriate for that point in the window " +
        "(early = kickoff / clarify, middle = advance milestones, last = wrap / close).\n\n" +
        "Return ONLY JSON:\n" +
        '{"reasoning":"2-4 sentences on how this timeframe maps to the goal",' +
        `"prompts":["autonomous prompt for slot 1", "..."]}\n` +
        `prompts length MUST equal ${n}. Each prompt is 1-4 sentences. No markdown fences.`,
    },
    {
      role: "user",
      content: [
        `Goal:\n${opts.goal}`,
        opts.windowSummary,
        `Fire times (${n}):\n${slotLines}`,
        opts.notes.length > 0
          ? `Work notes:\n${opts.notes.map((n) => `- ${n}`).join("\n")}`
          : "Work notes: (none)",
        opts.conversationContext?.trim()
          ? `Recent conversation:\n${opts.conversationContext.trim()}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]);

  try {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) throw new Error("no json");
    const parsed = JSON.parse(match[0]) as {
      reasoning?: string;
      prompts?: unknown;
    };
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.map(coercePromptText).filter(Boolean)
      : [];
    if (prompts.length === 0) throw new Error("empty prompts");
    while (prompts.length < n) {
      prompts.push(prompts[prompts.length - 1] ?? opts.goal);
    }
    const reasoning =
      typeof parsed.reasoning === "string"
        ? parsed.reasoning.trim()
        : "";
    return {
      reasoning:
        reasoning ||
        `Using a ${n}-prompt schedule across the goal window to advance: ${opts.goal}`,
      prompts: prompts.slice(0, n),
    };
  } catch {
    return inventStepPromptsFallback(opts);
  }
}

function inventStepPromptsFallback(opts: {
  goal: string;
  slots: ScheduleSlot[];
  windowSummary: string;
}): { reasoning?: string; prompts: string[] } {
  const n = opts.slots.length;
  return {
    reasoning: `${opts.windowSummary}\n\nSplit work on "${opts.goal}" into ${n} timed agent prompts across the window.`,
    prompts: opts.slots.map((s, i) => {
      if (n === 1) {
        return (
          `You are running a timed Work check-in for this goal: ${opts.goal}\n\n` +
          `What is the next concrete step, any blockers, and what should happen before the window ends?`
        );
      }
      if (i === 0) {
        return (
          `Kick off the goal timeframe for: ${opts.goal}\n\n` +
          `Clarify the outcome, first actions, and blockers. Scheduled for ${s.label}.`
        );
      }
      if (i === n - 1) {
        return (
          `Wrap up the goal timeframe for: ${opts.goal}\n\n` +
          `Summarize progress, close remaining gaps, and note what is still open. Scheduled for ${s.label}.`
        );
      }
      return (
        `Continue (${i + 1}/${n}) toward: ${opts.goal}\n\n` +
        `Advance the next milestone and surface blockers. Scheduled for ${s.label}.`
      );
    }),
  };
}
