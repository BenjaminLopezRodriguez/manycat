export type BudgetSummary = {
  plan: string;
  usedCents: number;
  ceilingCents: number | null;
  remainingCents: number | null;
};

/** True when a hard-capped plan has no remaining compute budget. */
export function isBudgetExhausted(
  budget: BudgetSummary | null | undefined,
): boolean {
  if (!budget) return false;
  if (budget.ceilingCents == null) return false;
  if (budget.remainingCents != null) return budget.remainingCents <= 0;
  return budget.usedCents >= budget.ceilingCents;
}

export function formatBudgetCents(cents: number | null | undefined): string {
  if (cents == null) return "∞";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Detect server BudgetExceededError surfaced through tRPC. */
export function isBudgetExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const data = "data" in err ? (err as { data?: { budgetExceeded?: boolean } }).data : undefined;
  if (data?.budgetExceeded) return true;
  const message =
    "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  return /budget exceeded/i.test(message);
}
