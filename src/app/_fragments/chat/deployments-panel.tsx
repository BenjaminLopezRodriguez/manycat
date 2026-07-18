"use client";

import * as React from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CloudUploadIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { isBudgetExhausted } from "@/lib/billing";
import { api } from "@/trpc/react";
import type { Project } from "./data";

type DeploymentsPanelProps = {
  projects: Project[];
  onProjectRunResult: (
    projectId: string,
    result: {
      status: "running" | "success" | "failed";
      url?: string;
      log?: string;
      startedAt: string;
      finishedAt?: string;
    },
  ) => void;
};

function formatCents(cents: number | null | undefined) {
  if (cents == null) return "∞";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function DeploymentsPanel({
  projects,
  onProjectRunResult,
}: DeploymentsPanelProps) {
  const budgetQuery = api.project.budget.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const dbProjects = api.project.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const runMutation = api.project.run.useMutation();
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const budget = budgetQuery.data;
  const exhausted = isBudgetExhausted(budget);
  const deployable = React.useMemo(() => {
    const fromDb = dbProjects.data ?? [];
    if (fromDb.length > 0) {
      return fromDb.map((p) => ({
        id: p.id,
        name: p.name,
        githubRepo: p.githubRepo,
        mirrorGithubRepo: p.mirrorGithubRepo,
        contentBackend: p.contentBackend,
        neonMode: p.neonMode,
        repo: p.githubRepo ?? p.mirrorGithubRepo ?? p.name,
        railwayDomain: p.railwayDomain,
        lastRun: projects.find((c) => c.id === p.id || c.repo === p.githubRepo)
          ?.lastRun,
      }));
    }
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      githubRepo: null as string | null,
      mirrorGithubRepo: null as string | null,
      contentBackend: null as "github" | "virtual" | null,
      neonMode: null as "shared" | "dedicated" | null,
      repo: p.repo,
      railwayDomain: p.lastRun?.url,
      lastRun: p.lastRun,
    }));
  }, [dbProjects.data, projects]);

  async function runRailway(projectId: string, githubRepo: string | null) {
    if (exhausted) {
      setError("Compute budget exceeded. Subscribe to continue deploying.");
      return;
    }
    setError(null);
    setRunningId(projectId);
    const startedAt = new Date().toISOString();
    onProjectRunResult(projectId, { status: "running", startedAt });

    try {
      const result = await runMutation.mutateAsync({
        workflowId: projectId,
        runConfig: {
          kind: "railway",
          railway: githubRepo ? { githubRepo } : undefined,
        },
      });
      onProjectRunResult(projectId, {
        status: result.status,
        url: result.url,
        log: result.log,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      });
      if (result.status === "failed" && result.log) setError(result.log);
      await budgetQuery.refetch();
      await dbProjects.refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onProjectRunResult(projectId, {
        status: "failed",
        log: message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-8 py-8 md:px-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <HugeiconsIcon icon={CloudUploadIcon} size={18} />
            <span className="text-xs font-medium tracking-wide uppercase">
              Deployments
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            Publish account-owned projects to the Railway workload plane. Live
            URLs are public previews — never mixed with Manycat control-plane
            services.
          </p>
          {budget ? (
            <p className="text-muted-foreground text-xs">
              Plan <span className="text-foreground font-medium">{budget.plan}</span>
              {" · "}
              used {formatCents(budget.usedCents)}
              {budget.ceilingCents != null
                ? ` / ${formatCents(budget.ceilingCents)}`
                : " (metered)"}
            </p>
          ) : null}
        </header>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
            {/budget exceeded/i.test(error) ? (
              <>
                {" "}
                <Link href="/billing" className="underline underline-offset-2">
                  View billing
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        {exhausted && !error ? (
          <p className="text-destructive text-sm" role="alert">
            Usage limit reached.{" "}
            <Link href="/billing" className="underline underline-offset-2">
              Subscribe to keep deploying
            </Link>
          </p>
        ) : null}

        {deployable.length === 0 ? (
          <div className="border-border flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed px-8 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              Import or create from prompt, then Run on Railway.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {deployable.map((p) => {
              const userRepo =
                typeof p.githubRepo === "string" && p.githubRepo.includes("/")
                  ? p.githubRepo
                  : null;
              const hasMirror =
                typeof p.mirrorGithubRepo === "string" &&
                p.mirrorGithubRepo.includes("/");
              const canRun =
                userRepo !== null ||
                hasMirror ||
                p.contentBackend === "virtual";
              const url = p.railwayDomain ?? p.lastRun?.url;
              const busy = runningId === p.id || p.lastRun?.status === "running";
              return (
                <li
                  key={p.id}
                  className="border-border flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {p.repo}
                      {p.lastRun?.status ? ` · ${p.lastRun.status}` : null}
                    </span>
                    {p.neonMode === "shared" ? (
                      <span className="text-muted-foreground text-xs">
                        Shared schema · upgrade for dedicated DB
                      </span>
                    ) : p.neonMode === "dedicated" ? (
                      <span className="text-muted-foreground text-xs">
                        Dedicated Neon
                      </span>
                    ) : null}
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground inline-flex max-w-full items-center gap-1 truncate text-xs underline-offset-2 hover:underline"
                      >
                        {url}
                        <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
                      </a>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    disabled={
                      busy || !canRun || exhausted || runMutation.isPending
                    }
                    onClick={() => {
                      if (!canRun) return;
                      void runRailway(p.id, userRepo);
                    }}
                  >
                    <HugeiconsIcon icon={CloudUploadIcon} size={14} />
                    {busy ? "Deploying…" : exhausted ? "Limit reached" : "Run on Railway"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
