"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import type { LastRun, Project, RunConfig, Workflow } from "./data";

type ProjectsProps = {
  projects: Project[];
  workflows: Workflow[];
  onOpenWorkflow: (id: string) => void;
  onRunStart: (projectId: string) => void;
  onRunDone: (projectId: string, run: LastRun) => void;
  onConfigChange: (projectId: string, runConfig: RunConfig) => void;
};

function RunStatusPill({ status }: { status: LastRun["status"] }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
        status === "running" && "bg-primary/20 text-primary",
        status === "success" && "bg-muted text-muted-foreground",
        status === "failed" && "bg-destructive/20 text-destructive",
      )}
    >
      {status}
    </span>
  );
}

const selectClass =
  "h-9 w-full min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm";

function RunConfigEditor({
  runConfig,
  onSave,
}: {
  runConfig: RunConfig;
  onSave: (runConfig: RunConfig) => void;
}) {
  const [kind, setKind] = React.useState(runConfig.kind);
  const [projectName, setProjectName] = React.useState(
    runConfig.vercel?.projectName ?? "",
  );
  const [command, setCommand] = React.useState(runConfig.custom?.command ?? "");

  const dirty =
    kind !== runConfig.kind ||
    projectName !== (runConfig.vercel?.projectName ?? "") ||
    command !== (runConfig.custom?.command ?? "");

  function save() {
    const next: RunConfig =
      kind === "vercel"
        ? { kind, vercel: projectName ? { projectName } : undefined }
        : kind === "custom"
          ? { kind, custom: { command } }
          : { kind: "none" };
    onSave(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as RunConfig["kind"])}
        className={selectClass}
      >
        <option value="none">None</option>
        <option value="vercel">Vercel</option>
        <option value="custom">Custom command</option>
      </select>
      {kind === "vercel" ? (
        <Input
          placeholder="Vercel project name (optional)"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      ) : null}
      {kind === "custom" ? (
        <Input
          placeholder="Command (e.g. npm test)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
      ) : null}
      {dirty ? (
        <Button size="sm" variant="secondary" onClick={save} className="self-start">
          Save
        </Button>
      ) : null}
    </div>
  );
}

export default function Projects({
  projects,
  workflows,
  onOpenWorkflow,
  onRunStart,
  onRunDone,
  onConfigChange,
}: ProjectsProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  if (selected) {
    return (
      <ProjectDetail
        project={selected}
        workflows={workflows.filter((w) => selected.workflowIds.includes(w.id))}
        onBack={() => setSelectedId(null)}
        onOpenWorkflow={onOpenWorkflow}
        onRunStart={onRunStart}
        onRunDone={onRunDone}
        onConfigChange={onConfigChange}
      />
    );
  }

  return (
    <div className="bg-muted/20 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Projects</h2>
          <p className="text-muted-foreground text-sm">
            Imported repos and their deploys.
          </p>
        </header>

        {projects.length === 0 ? (
          <p className="text-muted-foreground text-center text-sm">
            No projects yet — import a repo to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className="bg-card hover:bg-muted/50 flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.lastRun ? <RunStatusPill status={p.lastRun.status} /> : null}
                </div>
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {p.repo}
                </div>
                <div className="text-muted-foreground text-xs">
                  {p.workflowIds.length}{" "}
                  {p.workflowIds.length === 1 ? "workflow" : "workflows"}
                </div>
                {p.lastRun?.url ? (
                  <a
                    href={p.lastRun.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary truncate text-xs hover:underline"
                  >
                    {p.lastRun.url}
                  </a>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  workflows,
  onBack,
  onOpenWorkflow,
  onRunStart,
  onRunDone,
  onConfigChange,
}: {
  project: Project;
  workflows: Workflow[];
  onBack: () => void;
  onOpenWorkflow: (id: string) => void;
  onRunStart: (projectId: string) => void;
  onRunDone: (projectId: string, run: LastRun) => void;
  onConfigChange: (projectId: string, runConfig: RunConfig) => void;
}) {
  const [logOpen, setLogOpen] = React.useState(false);
  const runMutation = api.project.run.useMutation();
  const isRunning = project.lastRun?.status === "running";

  function run() {
    const workflowId = project.workflowIds[0];
    if (!workflowId) return;
    const startedAt = new Date().toISOString();
    onRunStart(project.id);
    runMutation.mutate(
      { workflowId, runConfig: project.runConfig },
      {
        onSuccess: (data) => onRunDone(project.id, data),
        onError: (err) =>
          onRunDone(project.id, {
            status: "failed",
            log: err.message,
            startedAt,
            finishedAt: new Date().toISOString(),
          }),
      },
    );
  }

  return (
    <div className="bg-muted/20 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to projects"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <h2 className="text-xl font-semibold">{project.name}</h2>
        </div>
        <div className="text-muted-foreground pl-9 font-mono text-xs">
          {project.repo}
        </div>

        <div className="bg-card rounded-2xl border p-4">
          <div className="mb-2 text-sm font-medium">Workflows</div>
          <div className="flex flex-col gap-1">
            {workflows.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onOpenWorkflow(w.id)}
                className="hover:bg-muted/50 flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm"
              >
                <span>{w.name}</span>
                <span className="text-muted-foreground text-xs capitalize">
                  {w.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-2xl border p-4">
          <div className="mb-3 text-sm font-medium">Run</div>

          <RunConfigEditor
            runConfig={project.runConfig}
            onSave={(rc) => onConfigChange(project.id, rc)}
          />

          {project.runConfig.kind !== "none" ? (
            <Button onClick={run} disabled={isRunning} size="sm" className="mt-3">
              {isRunning ? "Running…" : "Run"}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              No run action configured for this project.
            </p>
          )}

          {project.lastRun ? (
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <RunStatusPill status={project.lastRun.status} />
                {project.lastRun.url ? (
                  <a
                    href={project.lastRun.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary truncate hover:underline"
                  >
                    {project.lastRun.url}
                  </a>
                ) : null}
              </div>
              {project.lastRun.log ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setLogOpen((v) => !v)}
                    className="text-muted-foreground text-xs hover:underline"
                  >
                    {logOpen ? "Hide log" : "Show log"}
                  </button>
                  {logOpen ? (
                    <pre className="bg-muted/50 mt-2 max-h-64 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
                      {project.lastRun.log}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
