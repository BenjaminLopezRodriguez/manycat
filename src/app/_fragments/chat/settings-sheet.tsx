"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Chart01Icon,
} from "@hugeicons/core-free-icons";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatBudgetCents,
  isBudgetExhausted,
  type BudgetSummary,
} from "@/lib/billing";
import { cn } from "@/lib/utils";

type SettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: BudgetSummary | null;
};

export default function SettingsSheet({
  open,
  onOpenChange,
  budget,
}: SettingsSheetProps) {
  const exhausted = isBudgetExhausted(budget);
  const used = budget?.usedCents ?? 0;
  const ceiling = budget?.ceilingCents;
  const pct =
    ceiling != null && ceiling > 0
      ? Math.min(100, Math.round((used / ceiling) * 100))
      : 0;
  const usageLabel =
    ceiling != null
      ? `${formatBudgetCents(used)} / ${formatBudgetCents(ceiling)}`
      : budget
        ? `${formatBudgetCents(used)} metered`
        : "—";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Account preferences and billing.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-2 px-4">
          <Link
            href="/billing"
            onClick={() => onOpenChange(false)}
            className={cn(
              "hover:bg-muted flex flex-col gap-2 rounded-2xl border px-4 py-3.5 transition-colors",
              exhausted && "border-destructive/40 bg-destructive/5",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <HugeiconsIcon icon={Chart01Icon} size={18} />
                <span className="text-sm font-medium">Usage</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
                <span>{usageLabel}</span>
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
              </div>
            </div>
            <div
              className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out",
                  exhausted ? "bg-destructive" : "bg-foreground/55",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            {exhausted ? (
              <p className="text-destructive text-xs">
                Limit reached — tap to subscribe
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                View billing and plans
              </p>
            )}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
