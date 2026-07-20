import type { WorkPlanCadence } from "@/server/db/schema";

/** Advance from `from` by one cadence step (UTC math; timezone is display-only in v1). */
export function advanceDueAt(from: Date, cadence: WorkPlanCadence): Date {
  const next = new Date(from.getTime());
  if (cadence.kind === "daily") {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (cadence.kind === "weekdays") {
    do {
      next.setUTCDate(next.getUTCDate() + 1);
    } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
    return next;
  }
  const hours = Math.max(1, Math.floor(cadence.hours));
  next.setUTCHours(next.getUTCHours() + hours);
  return next;
}

/**
 * First fire time for a new plan.
 * Uses startsAt if it is still in the future; otherwise advances from now
 * (or from startsAt) until we land on a due time >= now and <= endsAt.
 */
export function computeInitialNextDueAt(opts: {
  startsAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
  now?: Date;
}): Date | null {
  const now = opts.now ?? new Date();
  if (opts.endsAt.getTime() <= now.getTime()) return null;
  if (opts.startsAt.getTime() > now.getTime()) return opts.startsAt;

  let due = opts.startsAt;
  // Cap iterations to avoid infinite loops on bad cadence.
  for (let i = 0; i < 10_000; i++) {
    due = advanceDueAt(due, opts.cadence);
    if (due.getTime() > opts.endsAt.getTime()) return null;
    if (due.getTime() >= now.getTime()) return due;
  }
  return null;
}

export function computeNextDueAfterFire(opts: {
  firedAt: Date;
  endsAt: Date;
  cadence: WorkPlanCadence;
}): Date | null {
  const next = advanceDueAt(opts.firedAt, opts.cadence);
  if (next.getTime() > opts.endsAt.getTime()) return null;
  return next;
}

export function isWithinPlanWindow(opts: {
  at: Date;
  startsAt: Date;
  endsAt: Date;
}): boolean {
  const t = opts.at.getTime();
  return t >= opts.startsAt.getTime() && t <= opts.endsAt.getTime();
}
