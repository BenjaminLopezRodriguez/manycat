"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";

export function WorkConnectionsPane() {
  const status = api.work.calendarStatus.useQuery();
  const disconnect = api.work.calendarDisconnect.useMutation({
    onSuccess: () => void status.refetch(),
  });

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 px-8 py-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground text-sm">
          Connect Google Calendar so Work plans can mirror as events. Manycat
          still owns the schedule.
        </p>
      </header>

      <div className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Google Calendar</p>
            <p className="text-muted-foreground text-xs">
              {!status.data?.configured
                ? "Not configured on this deploy"
                : status.data.connected
                  ? "Connected — plans mirror as events"
                  : "Not connected"}
            </p>
          </div>
          {status.data?.configured ? (
            status.data.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void disconnect.mutateAsync()}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" render={<a href="/api/integrations/google-calendar/start" />}>
                Connect
              </Button>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function WorkAutomationsPane() {
  const plans = api.work.listPlans.useQuery({});
  const pause = api.work.pausePlan.useMutation({
    onSuccess: () => void plans.refetch(),
  });
  const resume = api.work.updatePlan.useMutation({
    onSuccess: () => void plans.refetch(),
  });

  const rows = plans.data ?? [];

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 px-8 py-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Automations</h1>
        <p className="text-muted-foreground text-sm">
          Scheduled prompts for your goal timeframe. Pause or resume anytime.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No goal timeframes yet. Open a Work chat and use the clock icon in the
          prompt box.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((plan) => (
            <li
              key={plan.id}
              className="bg-card flex items-start justify-between gap-3 rounded-2xl border p-4"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">
                  {plan.promptTemplate.slice(0, 80) || "Untitled plan"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {plan.status} · next{" "}
                  {plan.nextDueAt
                    ? new Date(plan.nextDueAt).toLocaleString()
                    : "—"}
                </p>
              </div>
              {plan.status === "active" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pause.mutateAsync({ planId: plan.id })}
                >
                  Pause
                </Button>
              ) : plan.status === "paused" ? (
                <Button
                  size="sm"
                  onClick={() =>
                    void resume.mutateAsync({
                      planId: plan.id,
                      status: "active",
                    })
                  }
                >
                  Resume
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WorkActivityPane() {
  const plans = api.work.listPlans.useQuery({});
  const active = (plans.data ?? []).filter((p) => p.status === "active");

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 px-8 py-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Upcoming timed prompts inside your goal windows.
        </p>
      </header>
      {active.length === 0 ? (
        <p className="text-muted-foreground text-sm">No upcoming sessions.</p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {active.map((plan) => (
            <li key={plan.id} className="py-3 text-sm">
              <p className="font-medium">
                {plan.nextDueAt
                  ? new Date(plan.nextDueAt).toLocaleString()
                  : "Unscheduled"}
              </p>
              <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                {plan.promptTemplate || "Goal prompt"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
