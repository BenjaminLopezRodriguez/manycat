import type { WorkPlanCadence } from "@/server/db/schema";
import {
  advanceDueAt,
  computeInitialNextDueAt,
} from "@/server/work/cadence";

export type ScheduleSlot = {
  at: Date;
  /** e.g. "2:10pm Monday" */
  label: string;
};

/** Format a fire time for schedule tiles: `2:10pm Monday`. */
export function formatPromptSlotLabel(at: Date, timeZone?: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone ?? undefined,
  })
    .format(at)
    .replace(/\s/g, "")
    .toLowerCase();
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timeZone ?? undefined,
  }).format(at);
  return `${time} ${weekday}`;
}

/** Expand upcoming prompt fire times inside a goal window. */
export function expandScheduleSlots(opts: {
  startsAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
  timeZone?: string;
  now?: Date;
  limit?: number;
}): ScheduleSlot[] {
  const limit = opts.limit ?? 12;
  const first = computeInitialNextDueAt({
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    cadence: opts.cadence,
    now: opts.now,
  });
  if (!first) return [];

  const slots: ScheduleSlot[] = [];
  let cursor = first;
  for (let i = 0; i < limit; i++) {
    if (cursor.getTime() > opts.endsAt.getTime()) break;
    slots.push({
      at: cursor,
      label: formatPromptSlotLabel(cursor, opts.timeZone),
    });
    const next = advanceDueAt(cursor, opts.cadence);
    if (next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return slots;
}
