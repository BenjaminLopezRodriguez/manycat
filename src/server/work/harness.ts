import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";
import { createWorkPlan, generateAgenda } from "@/server/work/plans";
import { expandScheduleSlots } from "@/server/work/schedule-preview";
import type { WorkPlanCadence } from "@/server/db/schema";

export type GoalTimeframeToolResult = {
  planId: string;
  workflowId: string;
  hours: number;
  notify: boolean;
  goal: string;
  promptTemplate: string;
  slots: { at: string; label: string }[];
};

const TOOL_HINT = `
You have one tool for Work mode:

set_goal_timeframe — schedule timed prompts inside a goal window (the model is NOT running continuously).
Call it by emitting exactly this block (and nothing else in that block):

<<<TOOL set_goal_timeframe
{"hours":24,"goal":"short goal text","notify":true}
TOOL>>>

hours must be one of: 6, 12, 24, 48, 72, 120, 168.
notify=true means email/push when a timed prompt fires.
After the tool runs you will get a result; then reply briefly to the user.
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
  const match = text.match(
    /<<<TOOL\s+set_goal_timeframe\s*\n([\s\S]*?)\nTOOL>>>/i,
  );
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
}): Promise<GoalTimeframeToolResult> {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + opts.hours * 60 * 60 * 1000);
  const cadence = cadenceForHours(opts.hours);

  const promptTemplate = await generateAgenda({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    goalHint: opts.goal,
  });

  const plan = await createWorkPlan({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    startsAt,
    endsAt,
    cadence,
    timezone: opts.timeZone,
    promptTemplate,
    notify: opts.notify,
  });

  const slots = expandScheduleSlots({
    startsAt: plan.startsAt,
    endsAt: plan.endsAt,
    cadence: plan.cadence,
    timeZone: opts.timeZone,
  }).map((s) => ({ at: s.at.toISOString(), label: s.label }));

  return {
    planId: plan.id,
    workflowId: opts.workflowId,
    hours: opts.hours,
    notify: opts.notify,
    goal: opts.goal,
    promptTemplate,
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
    opts.timeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  const systemPrompt =
    "You are Manycat's workplace assistant. Help the user plan and track work. " +
    "You can set a goal timeframe so timed prompts fire inside a window " +
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
    return { reply: cleaned || first };
  }

  const schedule = await executeGoalTimeframe({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    hours: call.hours,
    goal: call.goal,
    notify: call.notify,
    timeZone,
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
          notify: schedule.notify,
          slots: schedule.slots.map((s) => `[prompt ${s.label}]`),
        }) +
        `\n\nConfirm briefly that the goal timeframe is set and mention the first few timed prompts.`,
    },
  ]);

  return { reply: followUp, schedule };
}

export { parseToolCall, executeGoalTimeframe, cadenceForHours };
