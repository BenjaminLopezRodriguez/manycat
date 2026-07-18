"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBudgetCents, type BudgetSummary } from "@/lib/billing";

type UpgradeLimitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: BudgetSummary | null;
};

export default function UpgradeLimitDialog({
  open,
  onOpenChange,
  budget,
}: UpgradeLimitDialogProps) {
  const used = formatBudgetCents(budget?.usedCents ?? 0);
  const ceiling =
    budget?.ceilingCents != null
      ? formatBudgetCents(budget.ceilingCents)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usage limit reached</DialogTitle>
          <DialogDescription>
            {ceiling
              ? `You've used ${used} of your ${ceiling} compute budget. Subscribe to keep creating, deploying, and generating.`
              : "You've hit your compute budget. Subscribe to keep creating, deploying, and generating."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button render={<Link href="/billing" />} onClick={() => onOpenChange(false)}>
            View billing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
