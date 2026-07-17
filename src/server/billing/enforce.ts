/**
 * Ongoing enforcement stub — call from a cron / Railway Function later.
 * Stops free/sub accounts that crossed their ceiling (never touches control plane).
 */
export async function listOverBudgetAccountIds(): Promise<string[]> {
  // Phase 3: query Railway usage, reconcile computeUsedCents, return offenders.
  return [];
}
