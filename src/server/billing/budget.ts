import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { accounts } from "@/server/db/schema";

export type BillingPlan = "free" | "metered" | "sub";

/** Default free tier ceiling: $5.00 */
export const FREE_CEILING_CENTS = 500;
/** Subscription tier ceiling: $30.00 */
export const SUB_CEILING_CENTS = 3000;

/** Conservative estimate charged when spinning up a Railway deploy (until invoice reconcile). */
export const ESTIMATED_DEPLOY_CENTS = 25;
/** Conservative estimate for sandbox create. */
export const ESTIMATED_SANDBOX_CENTS = 15;

export function ceilingForPlan(plan: BillingPlan): number | null {
  switch (plan) {
    case "free":
      return FREE_CEILING_CENTS;
    case "sub":
      return SUB_CEILING_CENTS;
    case "metered":
      return null; // pay-as-you-go past $5; no hard stop
  }
}

export function remainingBudgetCents(
  plan: BillingPlan,
  usedCents: number,
): number | null {
  const ceiling = ceilingForPlan(plan);
  if (ceiling === null) return null;
  return Math.max(0, ceiling - usedCents);
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly plan: BillingPlan,
    public readonly usedCents: number,
    public readonly ceilingCents: number,
  ) {
    super(
      `Compute budget exceeded for ${plan} plan ($${usedCents / 100} / $${ceilingCents / 100}). Upgrade to metered or sub to continue.`,
    );
    this.name = "BudgetExceededError";
  }
}

async function getAccount(accountId: string) {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureAccount(accountId: string) {
  const existing = await getAccount(accountId);
  if (existing) return existing;

  await db
    .insert(accounts)
    .values({ id: accountId, billingPlan: "free" })
    .onConflictDoNothing();

  const again = await getAccount(accountId);
  if (!again) throw new Error("Failed to ensure account");
  return again;
}

/**
 * Pre-flight gate: free/sub hard-stop at ceiling; metered always allowed.
 */
export async function assertCanSpend(
  accountId: string,
  estimatedCents: number,
) {
  const account = await ensureAccount(accountId);
  const ceiling = ceilingForPlan(account.billingPlan);
  if (ceiling === null) return account;

  if (account.computeUsedCents + estimatedCents > ceiling) {
    throw new BudgetExceededError(
      account.billingPlan,
      account.computeUsedCents,
      ceiling,
    );
  }
  return account;
}

export async function addUsage(accountId: string, cents: number) {
  if (cents <= 0) return;
  const account = await ensureAccount(accountId);
  await db
    .update(accounts)
    .set({ computeUsedCents: account.computeUsedCents + cents })
    .where(eq(accounts.id, accountId));
}

export function budgetSummary(account: {
  billingPlan: BillingPlan;
  computeUsedCents: number;
}) {
  const ceiling = ceilingForPlan(account.billingPlan);
  return {
    plan: account.billingPlan,
    usedCents: account.computeUsedCents,
    ceilingCents: ceiling,
    remainingCents: remainingBudgetCents(
      account.billingPlan,
      account.computeUsedCents,
    ),
  };
}
