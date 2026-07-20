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

/**
 * Build timed prompt cards for a goal window — one distinct prompt per fire slot.
 */
export async function generatePlanSteps(opts: {
  accountId: string;
  workflowId: string;
  goalHint?: string;
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
  const hint = opts.goalHint?.trim() ?? "Stay on track with ongoing work.";
  const notes = await notesForAgenda({ workflowId: opts.workflowId });

  if (slots.length === 0) {
    return {
      promptTemplate: `Timed goal prompt: ${hint}`,
      steps: [],
      reasoning: undefined,
    };
  }

  const generated = await inventStepPrompts({
    goal: hint,
    notes,
    slots,
  });

  const steps: PlanStep[] = slots.map((slot, i) => {
    const fromGen =
      generated.prompts[i]?.trim() ?? generated.prompts[0]?.trim();
    return {
      at: slot.at.toISOString(),
      label: slot.label,
      prompt: fromGen && fromGen.length > 0 ? fromGen : `Progress check on: ${hint}`,
    };
  });

  return {
    reasoning: generated.reasoning,
    steps,
    promptTemplate:
      steps[0]?.prompt ?? `Timed goal prompt: ${hint}`,
  };
}

async function inventStepPrompts(opts: {
  goal: string;
  notes: string[];
  slots: ScheduleSlot[];
}): Promise<{ reasoning?: string; prompts: string[] }> {
  const n = opts.slots.length;
  const slotLines = opts.slots
    .map((s, i) => `${i + 1}. ${s.label}`)
    .join("\n");

  if (!isChatModelConfigured()) {
    const prompts = opts.slots.map((s, i) => {
      if (n === 1) {
        return `Work the goal: ${opts.goal}\n\nWhat is the next concrete step?`;
      }
      if (i === 0) {
        return `Kick off: ${opts.goal}\n\nDefine the first action and any blockers.`;
      }
      if (i === n - 1) {
        return `Wrap up: ${opts.goal}\n\nSummarize progress and close remaining gaps.`;
      }
      return `Continue (${i + 1}/${n}) toward: ${opts.goal}\n\nAdvance the next milestone. Scheduled for ${s.label}.`;
    });
    return {
      reasoning:
        n > 1
          ? `Split into ${n} timed prompts across the goal window.`
          : undefined,
      prompts,
    };
  }

  const raw = await runChatCompletion([
    {
      role: "system",
      content:
        "You plan timed work prompts inside a goal window. The model is NOT running continuously — " +
        "each prompt fires once at its time. Return ONLY JSON:\n" +
        '{"reasoning":"1-2 sentences optional","prompts":["prompt for slot 1", "..."]}\n' +
        `prompts length MUST equal ${n}. Each prompt is 1-4 sentences, actionable, and progresses the goal ` +
        "(early = kickoff, middle = advance, last = wrap/close). Incorporate notes when useful.",
    },
    {
      role: "user",
      content: [
        `Goal: ${opts.goal}`,
        `Slots (${n}):\n${slotLines}`,
        opts.notes.length > 0
          ? `Notes:\n${opts.notes.map((n) => `- ${n}`).join("\n")}`
          : "Notes: (none)",
      ].join("\n\n"),
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
      ? parsed.prompts.map((p) => String(p).trim()).filter(Boolean)
      : [];
    if (prompts.length === 0) throw new Error("empty prompts");
    // Pad / trim to slot count.
    while (prompts.length < n) {
      prompts.push(prompts[prompts.length - 1] ?? opts.goal);
    }
    return {
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning.trim() || undefined
          : undefined,
      prompts: prompts.slice(0, n),
    };
  } catch {
    return inventStepPromptsFallback(opts);
  }
}

function inventStepPromptsFallback(opts: {
  goal: string;
  slots: ScheduleSlot[];
}): { reasoning?: string; prompts: string[] } {
  const n = opts.slots.length;
  return {
    reasoning:
      n > 1
        ? `Split into ${n} timed prompts across the goal window.`
        : undefined,
    prompts: opts.slots.map((s, i) => {
      if (i === 0) return `Kick off: ${opts.goal}`;
      if (i === n - 1) return `Wrap up: ${opts.goal}`;
      return `Continue (${i + 1}/${n}): ${opts.goal} — due ${s.label}`;
    }),
  };
}
