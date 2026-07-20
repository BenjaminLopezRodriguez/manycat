"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BellIcon,
  BellOffIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import type { WorkPlanCadence } from "@/server/db/schema";
import { expandScheduleSlots } from "@/server/work/schedule-preview";

/** Discrete plan windows from 6 hours to 1 week. */
const DURATION_STEPS = [
  { hours: 6, label: "6h" },
  { hours: 12, label: "12h" },
  { hours: 24, label: "1d" },
  { hours: 48, label: "2d" },
  { hours: 72, label: "3d" },
  { hours: 120, label: "5d" },
  { hours: 168, label: "1w" },
] as const;

const PLAN_COPY = {
  title: "Goal timeframe",
  description:
    "How long the agent has to pursue this goal. It schedules prompts inside that window — it isn’t running the whole time.",
  duration: "Timeframe",
  start: "Set timeframe",
  starting: "Setting…",
  triggerTitle: "Set goal timeframe",
} as const;

const DEFAULT_STEP = 2; // 1d

function cadenceForDuration(hours: number): WorkPlanCadence {
  if (hours <= 12) return { kind: "interval", hours: 6 };
  if (hours <= 48) return { kind: "interval", hours: 12 };
  return { kind: "daily" };
}

function durationLabel(hours: number) {
  const step = DURATION_STEPS.find((s) => s.hours === hours);
  if (step) return step.label;
  if (hours < 24) return `${hours}h`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  return `${hours}h`;
}

export type WorkScheduleCreated = {
  planId: string;
  workflowId: string;
  goal: string;
  notify: boolean;
  slots: { label: string; at: string }[];
};

export function WorkPlanButton({
  workflowId,
  goalHint,
  notify,
  onNotifyChange,
  onCreated,
  onSchedule,
}: {
  workflowId: string;
  goalHint?: string;
  notify: boolean;
  onNotifyChange: (next: boolean) => void;
  onCreated?: (planId: string) => void;
  onSchedule?: (schedule: WorkScheduleCreated) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(DEFAULT_STEP);

  const generateAgenda = api.work.generateAgenda.useMutation();
  const createPlan = api.work.createPlan.useMutation();
  const saving = generateAgenda.isPending || createPlan.isPending;

  const hours = DURATION_STEPS[stepIndex]?.hours ?? 24;
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  React.useEffect(() => {
    if (!open) setStepIndex(DEFAULT_STEP);
  }, [open]);

  async function savePlan() {
    const startsAt = new Date();
    startsAt.setSeconds(0, 0);
    const endsAt = new Date(startsAt.getTime() + hours * 60 * 60 * 1000);
    const cadence = cadenceForDuration(hours);

    const { agenda } = await generateAgenda.mutateAsync({
      workflowId,
      goalHint,
    });

    const plan = await createPlan.mutateAsync({
      workflowId,
      startsAt,
      endsAt,
      cadence,
      timezone: timeZone,
      promptTemplate: agenda,
      notify,
    });

    const slots = expandScheduleSlots({
      startsAt: new Date(plan.startsAt),
      endsAt: new Date(plan.endsAt),
      cadence: plan.cadence,
      timeZone,
    }).map((s) => ({ at: s.at.toISOString(), label: s.label }));

    onCreated?.(plan.id);
    const goalText = (() => {
      const fromHint = goalHint?.trim();
      if (fromHint) return fromHint;
      const fromAgenda = agenda.slice(0, 80).trim();
      if (fromAgenda) return fromAgenda;
      return "Goal timeframe";
    })();
    onSchedule?.({
      planId: plan.id,
      workflowId,
      goal: goalText,
      notify,
      slots,
    });
    setOpen(false);
  }

  const panel = (
    <PlanDurationPanel
      stepIndex={stepIndex}
      onStepIndexChange={setStepIndex}
      hours={hours}
      saving={saving}
      onCancel={() => setOpen(false)}
      onSave={() => void savePlan()}
      compact={!isMobile}
    />
  );

  const notifyBtn = (
    <button
      type="button"
      onClick={() => onNotifyChange(!notify)}
      title={notify ? "Notifications on" : "Notifications off"}
      aria-label={notify ? "Notifications on" : "Notifications off"}
      aria-pressed={notify}
      className={cn(
        "flex size-7 items-center justify-center rounded-full transition-colors",
        notify
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={notify ? BellIcon : BellOffIcon} size={14} />
    </button>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-0.5">
        <TriggerButton onClick={() => setOpen(true)} />
        {notifyBtn}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-4xl">
            <SheetHeader>
              <SheetTitle>{PLAN_COPY.title}</SheetTitle>
              <SheetDescription>{PLAN_COPY.description}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-2">{panel}</div>
            <SheetFooter className="gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void savePlan()} disabled={saving}>
                {saving ? PLAN_COPY.starting : PLAN_COPY.start}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          title={PLAN_COPY.triggerTitle}
          aria-label={PLAN_COPY.triggerTitle}
          className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors outline-none"
        >
          <HugeiconsIcon icon={Clock01Icon} size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64 p-2">
          <div
            onPointerDown={(e) => e.preventDefault()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {panel}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {notifyBtn}
    </div>
  );
}

function TriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={PLAN_COPY.triggerTitle}
      aria-label={PLAN_COPY.triggerTitle}
      className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-full transition-colors"
    >
      <HugeiconsIcon icon={Clock01Icon} size={14} />
    </button>
  );
}

function PlanDurationPanel({
  stepIndex,
  onStepIndexChange,
  hours,
  saving,
  onCancel,
  onSave,
  compact,
}: {
  stepIndex: number;
  onStepIndexChange: (i: number) => void;
  hours: number;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  compact: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-3", compact ? "p-1" : "py-1")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {PLAN_COPY.duration}
        </span>
        <span className="text-xs font-medium tabular-nums">
          {durationLabel(hours)}
        </span>
      </div>

      {compact ? (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {PLAN_COPY.description}
        </p>
      ) : null}

      <DurationChipSlider
        stepIndex={stepIndex}
        onStepIndexChange={onStepIndexChange}
      />

      {compact ? (
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving ? PLAN_COPY.starting : PLAN_COPY.start}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Chips as the track; a single sliding dot overlays the selected step. */
function DurationChipSlider({
  stepIndex,
  onStepIndexChange,
}: {
  stepIndex: number;
  onStepIndexChange: (i: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);

  const last = DURATION_STEPS.length - 1;

  const indexFromClientX = React.useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(t * last);
  }, [last]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onStepIndexChange(indexFromClientX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    onStepIndexChange(indexFromClientX(e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Goal timeframe"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={stepIndex}
      aria-valuetext={DURATION_STEPS[stepIndex]?.label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onStepIndexChange(Math.max(0, stepIndex - 1));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onStepIndexChange(Math.min(last, stepIndex + 1));
        } else if (e.key === "Home") {
          e.preventDefault();
          onStepIndexChange(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onStepIndexChange(last);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative touch-none select-none py-1 outline-none"
    >
      <div className="grid grid-cols-7 gap-0.5">
        {DURATION_STEPS.map((step, i) => {
          const selected = i === stepIndex;
          return (
            <button
              key={step.hours}
              type="button"
              tabIndex={-1}
              aria-pressed={selected}
              onClick={(e) => {
                e.stopPropagation();
                onStepIndexChange(i);
              }}
              className={cn(
                "rounded-full px-0.5 py-2.5 text-[10px] font-medium transition-colors",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm ring-2 ring-background transition-[left] duration-75"
        style={{
          left: `${((stepIndex + 0.5) / DURATION_STEPS.length) * 100}%`,
        }}
      />
    </div>
  );
}
