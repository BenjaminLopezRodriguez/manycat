import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";
import { createWorkPlan, updateWorkPlan } from "@/server/work/plans";
import {
  buildPlaceholderPlanSteps,
  generatePlanSteps,
} from "@/server/work/plan-steps";
import type { WorkPlanCadence } from "@/server/db/schema";

export type GoalTimeframeToolResult = {
  planId: string;
  workflowId: string;
  hours: number;
  notify: boolean;
  goal: string;
  promptTemplate: string;
  reasoning?: string;
  slots: { at: string; label: string; prompt: string }[];
};

const TOOL_HINT = `
You have one tool for Work mode:

set_goal_timeframe — set a goal timeframe, then the planner reasons about that window + goal
and authors timed autonomous prompts (the model is NOT running continuously).
Call it by emitting exactly this block (and nothing else in that block):

<<<TOOL set_goal_timeframe
{"hours":24,"goal":"concrete goal from the conversation","notify":true}
TOOL>>>

hours must be one of: 6, 12, 24, 48, 72, 120, 168.
goal must be a concrete outcome (not vague). Prefer the user's stated goal.
notify=true means email/push when a timed prompt fires.
After the tool runs you will get reasoning + prompts; then reply briefly to the user.
If the user is not asking to set a timeframe, answer normally without the tool.
`.trim();

function cadenceForHours(hours: number): WorkPlanCadence {
  if (hours <= 12) return { kind: "interval", hours: 6 };
  if (hours <= 48) return { kind: "interval", hours: 12 };
  return { kind: "daily" };
}

function parseToolCall(text: string): {
  hours: number;
  goal: string;
  notify: boolean;
} | null {
  const match = /<<<TOOL\s+set_goal_timeframe\s*\n([\s\S]*?)\nTOOL>>>/i.exec(text);
  if (!match?.[1]) return null;
  try {
    const raw = JSON.parse(match[1].trim()) as {
      hours?: number;
      goal?: string;
      notify?: boolean;
    };
    const hours = Number(raw.hours);
    if (![6, 12, 24, 48, 72, 120, 168].includes(hours)) return null;
    const goal = String(raw.goal ?? "").trim();
    if (!goal) return null;
    return { hours, goal, notify: raw.notify !== false };
  } catch {
    return null;
  }
}

async function executeGoalTimeframe(opts: {
  accountId: string;
  workflowId: string;
  hours: number;
  goal: string;
  notify: boolean;
  timeZone: string;
  conversationContext?: string;
}): Promise<GoalTimeframeToolResult> {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + opts.hours * 60 * 60 * 1000);
  const cadence = cadenceForHours(opts.hours);

  // Persist immediately so the timeframe is real even if LLM refine is slow.
  const placeholders = buildPlaceholderPlanSteps({
    goalHint: opts.goal,
    startsAt,
    endsAt,
    cadence,
    timeZone: opts.timeZone,
  });

  const plan = await createWorkPlan({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    startsAt,
    endsAt,
    cadence,
    timezone: opts.timeZone,
    promptTemplate: `Timed goal prompt: ${opts.goal}`,
    notify: opts.notify,
    steps: placeholders.steps,
  });

  let reasoning = placeholders.reasoning;
  let slots = placeholders.steps;
  let promptTemplate = placeholders.promptTemplate;

  try {
    const planned = await generatePlanSteps({
      accountId: opts.accountId,
      workflowId: opts.workflowId,
      goalHint: opts.goal,
      conversationContext: opts.conversationContext,
      startsAt,
      endsAt,
      cadence,
      timeZone: opts.timeZone,
    });
    await updateWorkPlan({
      planId: plan.id,
      accountId: opts.accountId,
      patch: {
        promptTemplate: planned.promptTemplate,
        steps: planned.steps,
      },
    });
    reasoning = planned.reasoning;
    slots = planned.steps;
    promptTemplate = planned.promptTemplate;
  } catch (err) {
    console.warn(
      "[executeGoalTimeframe] refine failed; keeping placeholders:",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    planId: plan.id,
    workflowId: opts.workflowId,
    hours: opts.hours,
    notify: opts.notify,
    goal: opts.goal,
    promptTemplate,
    reasoning,
    slots,
  };
}

/**
 * Work chat harness with set_goal_timeframe tool.
 * Uses a text tool protocol (Modal vLLM may not expose OpenAI tools reliably).
 */
export async function runWorkHarness(opts: {
  accountId: string;
  workflowId: string;
  prompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  timeZone?: string;
}): Promise<{
  reply: string;
  schedule?: GoalTimeframeToolResult;
}> {
  const timeZone =
    opts.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";

  const systemPrompt =
    "You are Manycat's workplace assistant. Help the user plan and track work. " +
    "When they want a goal timeframe, call set_goal_timeframe with the hours and a concrete goal — " +
    "the planner will reason about that window and author the timed prompts " +
    "(you are not running continuously).\n\n" +
    TOOL_HINT;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
    { role: "user", content: opts.prompt },
  ];

  const first = await runChatCompletion(messages);
  const call = parseToolCall(first);

  if (!call) {
    // Strip accidental tool markup if model mixed prose + tool badly.
    const cleaned = first.replace(/<<<TOOL[\s\S]*?TOOL>>>/gi, "").trim();
    return { reply: cleaned.length > 0 ? cleaned : first };
  }

  const schedule = await executeGoalTimeframe({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    hours: call.hours,
    goal: call.goal,
    notify: call.notify,
    timeZone,
    conversationContext: [
      ...opts.history.map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
      ),
      `User: ${opts.prompt}`,
    ]
      .join("\n")
      .slice(0, 8000),
  });

  const followUp = await runChatCompletion([
    ...messages,
    { role: "assistant", content: first },
    {
      role: "user",
      content:
        `Tool result for set_goal_timeframe:\n` +
        JSON.stringify({
          ok: true,
          planId: schedule.planId,
          hours: schedule.hours,
          goal: schedule.goal,
          notify: schedule.notify,
          reasoning: schedule.reasoning,
          slots: schedule.slots.map((s) => ({
            when: s.label,
            prompt: s.prompt.slice(0, 160),
          })),
        }) +
        `\n\nConfirm briefly that the timeframe is set and the plan fits the goal. ` +
        `The UI already shows each timed prompt card — keep your reply short.`,
    },
  ]);

  return { reply: followUp, schedule };
}

export { parseToolCall, executeGoalTimeframe, cadenceForHours };
