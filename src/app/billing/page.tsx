"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useSession } from "next-auth/react";

import { ManycatLogo } from "@/components/manycat-logo";
import { Button } from "@/components/ui/button";
import {
  formatBudgetCents,
  isBudgetExhausted,
} from "@/lib/billing";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    price: "$5",
    period: "included",
    blurb: "Hard cap — good for trying Manycat.",
    features: ["$5 compute budget", "Shared app database", "Sandbox + deploy"],
    cta: null,
  },
  {
    id: "sub" as const,
    name: "Pro",
    price: "$30",
    period: "/ month",
    blurb: "Higher ceiling and dedicated Postgres.",
    features: [
      "$30 compute budget",
      "Dedicated Neon database",
      "Create, deploy, and iterate",
    ],
    cta: "Subscribe",
  },
  {
    id: "metered" as const,
    name: "Metered",
    price: "Pay as you go",
    period: "",
    blurb: "No hard stop past the free allowance.",
    features: [
      "Unlimited compute (billed usage)",
      "Dedicated Neon database",
      "Best for heavy workloads",
    ],
    cta: "Switch to metered",
  },
] as const;

export default function BillingPage() {
  const router = useRouter();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const utils = api.useUtils();
  const budgetQuery = api.project.budget.useQuery(undefined, {
    enabled: signedIn,
  });
  const setPlan = api.project.setPlan.useMutation({
    onSuccess: async () => {
      await utils.project.budget.invalidate();
      router.push("/");
    },
  });

  const budget = budgetQuery.data;
  const exhausted = isBudgetExhausted(budget);
  const used = budget?.usedCents ?? 0;
  const ceiling = budget?.ceilingCents;
  const pct =
    ceiling != null && ceiling > 0
      ? Math.min(100, Math.round((used / ceiling) * 100))
      : 0;
  const currentPlan = budget?.plan ?? "free";

  if (status === "unauthenticated") {
    return (
      <div className="bg-background flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
        <ManycatLogo alt="manycat" width={48} height={48} className="size-12" />
        <p className="text-muted-foreground text-sm">
          Sign in to manage billing.
        </p>
        <Button render={<Link href="/signin?callbackUrl=/billing" />}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-dvh">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10 md:px-8">
        <header className="flex flex-col gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-1.5 px-2"
            render={<Link href="/" />}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            Back
          </Button>
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Billing
            </h1>
            <p className="text-muted-foreground text-sm md:text-base">
              Watch usage and subscribe when you hit your limit.
            </p>
          </div>
        </header>

        <section
          className={cn(
            "flex flex-col gap-3 rounded-3xl border p-5",
            exhausted && "border-destructive/40 bg-destructive/5",
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">Usage this period</h2>
            <span className="text-muted-foreground text-sm tabular-nums">
              {ceiling != null
                ? `${formatBudgetCents(used)} / ${formatBudgetCents(ceiling)}`
                : `${formatBudgetCents(used)} metered`}
            </span>
          </div>
          <div
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-out",
                exhausted ? "bg-destructive" : "bg-foreground/60",
              )}
              style={{ width: `${ceiling == null ? 8 : pct}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Plan: <span className="text-foreground font-medium">{currentPlan}</span>
            {exhausted
              ? " — limit reached. Subscribe to continue."
              : null}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const active = currentPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col gap-4 rounded-3xl border p-5",
                  active && "border-foreground/25 bg-muted/40",
                )}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-heading text-lg font-semibold">
                      {plan.name}
                    </h3>
                    {active ? (
                      <span className="bg-foreground text-background rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <p className="text-2xl font-semibold tracking-tight">
                    {plan.price}
                    {plan.period ? (
                      <span className="text-muted-foreground text-sm font-normal">
                        {" "}
                        {plan.period}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-sm">{plan.blurb}</p>
                </div>
                <ul className="flex flex-1 flex-col gap-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={16}
                        className="mt-0.5 shrink-0"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {plan.cta && !active ? (
                  <Button
                    className="w-full"
                    disabled={setPlan.isPending}
                    onClick={() => setPlan.mutate({ plan: plan.id })}
                  >
                    {setPlan.isPending ? "Updating…" : plan.cta}
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" disabled>
                    {active ? "Your plan" : "Included"}
                  </Button>
                )}
              </div>
            );
          })}
        </section>

        {setPlan.error ? (
          <p className="text-destructive text-sm">
            {setPlan.error.message || "Couldn't update plan."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
