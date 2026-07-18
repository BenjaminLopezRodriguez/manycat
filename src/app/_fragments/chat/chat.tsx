"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  BotIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit01Icon,
  GitBranchIcon,
  HelpCircleIcon,
  Image01Icon,
  Link01Icon,
  Menu01Icon,
  MoreVerticalIcon,
  News01Icon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  SidebarRight01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { wrapNextScaffoldBootstrapPrompt } from "@/lib/bootstrap-prompt";
import { dedupeId, slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { getFeaturedUpdate, updateHref } from "@/content/updates";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import { applyWorkspacePatch, useAgent, type AgentEvent } from "./agent-sim";
import type { EffortId, ModelId } from "@/lib/ai-models";
import {
  deriveProjectsFromWorkflows,
  initialWorkflows,
  messagePreview,
  type ApprovalMsg,
  type DiffMsg,
  type Msg,
  type Project,
  type TextMsg,
  type Workflow,
  type WorkflowStatus,
} from "./data";
import ImportRepoDialog from "./import-repo";
import IntegrationsSheet from "./integrations-sheet";
import MessageList, { InlineDiffEditor } from "./message-list";
import Projects, {
  LANDING_FEATURES,
  type LandingFeatureId,
} from "./projects";
import DeploymentsPanel from "./deployments-panel";
import SectionScaffold from "./section-scaffold";
import { getModes, type ShellView } from "./shell-modes";
import { ShellModeDrawerBody, ShellModeMenu } from "./shell-mode-menu";
import { useShellUrl } from "./use-shell-url";
import Workspace from "./workspace";

/** Icon badges that can pin to the mobile status bubble */
type BubbleBadge = "deploy" | "working" | "review";

const BUBBLE_BADGE: Record<
  BubbleBadge,
  { icon: typeof ArrowUp01Icon; className: string; label: string }
> = {
  deploy: {
    icon: ArrowUp01Icon,
    className: "bg-foreground text-background",
    label: "Deploying",
  },
  working: {
    icon: BotIcon,
    className: "bg-foreground text-background",
    label: "Agent working",
  },
  review: {
    icon: ArrowUpRight01Icon,
    className: "bg-muted-foreground text-background",
    label: "Needs review",
  },
};

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextMsgId(messages: Workflow["messages"]) {
  return messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;
}

function isMsg(value: unknown): value is Workflow["messages"][number] {
  if (!value || typeof value !== "object") return false;
  const m = value as { type?: string; id?: unknown };
  if (typeof m.id !== "number") return false;
  return (
    m.type === "text" ||
    m.type === "agent-status" ||
    m.type === "diff" ||
    m.type === "approval" ||
    m.type === "milestone"
  );
}

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  idle: "idle",
  working: "working",
  "needs-review": "needs review",
  done: "done",
};

function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
        status === "working" && "bg-primary/20 text-primary",
        status === "needs-review" && "bg-warning/20 text-warning-foreground",
        status === "done" && "bg-muted text-muted-foreground",
        status === "idle" && "text-muted-foreground",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const EMPTY_WORKFLOW: Workflow = {
  id: "",
  name: "",
  initials: "",
  avatarClass: "",
  repo: "",
  status: "idle",
  messages: [],
  workspace: [],
};

export default function Chat() {
  const isMobile = useIsMobile();
  const { mode, view, setMode, setView, forceDevWorkflows } = useShellUrl();
  const modes = React.useMemo(() => getModes(), []);
  const modeDef = modes.find((m) => m.id === mode) ?? modes[0]!;
  const [workflows, setWorkflows] = React.useState(initialWorkflows);
  const [projects, setProjects] = React.useState<Project[]>(() =>
    deriveProjectsFromWorkflows(initialWorkflows),
  );
  const [activeId, setActiveId] = React.useState<string | null>(
    initialWorkflows[0]?.id ?? null,
  );
  const [chatOpen, setChatOpen] = React.useState(false);
  const [diffsOpen, setDiffsOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [diffSnapPoint, setDiffSnapPoint] = React.useState<number | string>(
    0.45,
  );
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [activeDiff, setActiveDiff] = React.useState<DiffMsg | null>(null);
  const [draft, setDraft] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [integrationsOpen, setIntegrationsOpen] = React.useState(false);
  const [navMenuOpen, setNavMenuOpen] = React.useState(false);
  const [accountDrawerOpen, setAccountDrawerOpen] = React.useState(false);
  const [landingFeature, setLandingFeature] =
    React.useState<LandingFeatureId>("chat");
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const utils = api.useUtils();
  const { data: session, status: sessionStatus } = useSession();
  const signedIn = sessionStatus === "authenticated";
  const accountLabel =
    session?.login ?? session?.user?.name ?? session?.user?.email ?? "Account";
  const accountInitials = accountLabel.slice(0, 2).toUpperCase();
  const [creatingFromPrompt, setCreatingFromPrompt] = React.useState(false);
  const [aiModel, setAiModel] = React.useState<ModelId>("auto");
  const [aiEffort, setAiEffort] = React.useState<EffortId>("high");
  const createFromPrompt = api.workflow.createFromPrompt.useMutation();
  const runChat = api.workflow.runChat.useMutation();
  const runImage = api.workflow.runImage.useMutation();
  const importRepo = api.workflow.importRepo.useMutation();
  api.workflow.isEnabled.useQuery();
  const activeIdRef = React.useRef(activeId);
  activeIdRef.current = activeId;
  const sessionsQuery = api.workflow.listSessions.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 30_000,
  });
  const budgetQuery = api.project.budget.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 30_000,
  });
  const [sessionsHydrated, setSessionsHydrated] = React.useState(false);

  React.useEffect(() => {
    if (!signedIn || !sessionsQuery.data || sessionsHydrated) return;
    const restored: Workflow[] = sessionsQuery.data.map((s) => {
      const name = s.name || s.id;
      const repo =
        s.contentBackend === "virtual"
          ? "virtual"
          : (s.githubRepo ?? "virtual");
      const rawStatus = s.status ?? "idle";
      // Refresh mid-run has no attached stream — don't leave a permanent live chip.
      const orphanedWorking = rawStatus === "working";
      const baseMessages = (s.messages ?? [])
        .filter(isMsg)
        .filter((m) => m.type !== "agent-status");
      return {
        id: s.id,
        name,
        initials: name.slice(0, 2).toUpperCase() || "AP",
        avatarClass:
          repo === "virtual"
            ? "bg-sky-200 text-sky-900"
            : "bg-emerald-200 text-emerald-900",
        repo,
        status: orphanedWorking ? "idle" : rawStatus,
        messages: orphanedWorking
          ? [
              ...baseMessages,
              {
                id: nextMsgId(baseMessages),
                type: "text" as const,
                from: "agent" as const,
                text: "Previous run was interrupted (page reloaded). Send a message to continue.",
                time: nowTime(),
              },
            ]
          : baseMessages,
        workspace: (s.files ?? []).map((f) => ({
          path: f.path,
          contents: f.contents,
        })),
      };
    });
    if (restored.length > 0) {
      setWorkflows((prev) => {
        const byId = new Map(restored.map((w) => [w.id, w]));
        for (const w of prev) {
          if (w.id.startsWith("pending-") || w.status === "working") {
            byId.set(w.id, w);
          } else if (!byId.has(w.id)) {
            byId.set(w.id, w);
          }
        }
        const restoredIds = new Set(restored.map((w) => w.id));
        const localOnly = prev.filter((w) => !restoredIds.has(w.id));
        return [
          ...restored.map((w) => byId.get(w.id)!),
          ...localOnly.map((w) => byId.get(w.id)!),
        ];
      });
      setProjects((prev) => {
        const fromDb = restored.map((w) => ({
          id: w.id,
          name: w.name,
          repo: w.repo,
          workflowIds: [w.id],
          runConfig: { kind: "none" as const },
        }));
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const p of fromDb) byId.set(p.id, { ...byId.get(p.id), ...p });
        return [...byId.values()];
      });
      setActiveId((cur) => cur ?? restored[0]?.id ?? null);
    }
    setSessionsHydrated(true);
  }, [signedIn, sessionsQuery.data, sessionsHydrated]);

  React.useEffect(() => {
    if (!signedIn) {
      setSessionsHydrated(false);
      setWorkflows(initialWorkflows);
      setProjects(deriveProjectsFromWorkflows(initialWorkflows));
      setActiveId(null);
    }
  }, [signedIn]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") === "1") {
      setImportOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const bubbleBadges: BubbleBadge[] = [];
  if (workflows.some((w) => w.status === "working")) bubbleBadges.push("working");
  if (workflows.some((w) => w.status === "needs-review")) {
    bubbleBadges.push("review");
  }
  if (projects.some((p) => p.lastRun?.status === "running")) {
    bubbleBadges.push("deploy");
  }

  const active = workflows.find((w) => w.id === activeId) ?? null;
  const diffs = active?.messages.filter((m): m is DiffMsg => m.type === "diff") ?? [];
  const promptMsg = active?.messages.find(
    (m): m is TextMsg => m.type === "text" && m.from === "me",
  );
  const prompt = promptMsg?.text ?? active?.name ?? "";
  const pendingApproval = active?.messages.find(
    (m): m is ApprovalMsg => m.type === "approval" && m.resolved === null,
  );

  React.useEffect(() => {
    const first = active?.workspace[0]?.path ?? null;
    setActivePath(first);
    setActiveDiff(null);
    setPreviewUrl(null);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset path when switching workflows

  React.useEffect(() => {
    if (mode === "dev" && view === "workflows" && active) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [active?.messages.length, activeId, mode, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentEvent = React.useCallback((event: AgentEvent) => {
    setWorkflows((prev) =>
      prev.map((w) => {
        if (w.id !== activeIdRef.current) return w;
        switch (event.kind) {
          case "status":
            return {
              ...w,
              status: event.status,
              // Drop ephemeral working chips once the run leaves "working"
              messages:
                event.status === "working"
                  ? w.messages
                  : w.messages.filter((m) => m.type !== "agent-status"),
            };
          case "append":
            return { ...w, messages: [...w.messages, event.message] };
          case "upsert-status": {
            // One live status row per run — replace any prior agent-status
            const withoutStatus = w.messages.filter(
              (m) => m.type !== "agent-status",
            );
            return {
              ...w,
              messages: [...withoutStatus, event.message],
            };
          }
          case "patch-workspace":
            return {
              ...w,
              workspace: applyWorkspacePatch(
                w.workspace,
                event.path,
                event.contents,
                event.edited,
              ),
            };
          case "resolve-approval":
            return {
              ...w,
              messages: w.messages.map((m) =>
                m.id === event.messageId && m.type === "approval"
                  ? { ...m, resolved: event.resolved }
                  : m,
              ),
            };
          case "done":
            return w;
        }
      }),
    );

    if (event.kind === "patch-workspace") {
      setActivePath(event.path);
    }
  }, []);

  const handleAgentEventRef = React.useRef(handleAgentEvent);
  handleAgentEventRef.current = handleAgentEvent;

  // Create-from-prompt still owns a separate mutation — Stop must cover it too.
  const createRunStopRef = React.useRef(false);
  const [createRunStopping, setCreateRunStopping] = React.useState(false);

  const finishCreateRunStopped = React.useCallback(() => {
    createRunStopRef.current = false;
    setCreateRunStopping(false);
    handleAgentEventRef.current({
      kind: "append",
      message: {
        id: Date.now(),
        type: "text",
        from: "agent",
        text: "Stopped — the previous run may have left partial workspace changes. Review files before sending a new instruction.",
        time: nowTime(),
      },
    });
    handleAgentEventRef.current({ kind: "status", status: "idle" });
  }, []);

  const runAgentMutation = api.workflow.runAgent.useMutation({
    onSuccess: (data) => {
      if (createRunStopRef.current) {
        finishCreateRunStopped();
        return;
      }
      for (const event of data.events) {
        handleAgentEventRef.current(event);
      }
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
    },
    onError: (err) => {
      if (createRunStopRef.current) {
        finishCreateRunStopped();
        return;
      }
      handleAgentEventRef.current({
        kind: "append",
        message: {
          id: Date.now(),
          type: "text",
          from: "agent",
          text: `Generation failed — send a message to retry. (${err.message})`,
          time: nowTime(),
        },
      });
      handleAgentEventRef.current({ kind: "status", status: "idle" });
    },
  });

  const agent = useAgent({
    workflow: active ?? EMPTY_WORKFLOW,
    onEvent: handleAgentEvent,
    onPreviewUrl: setPreviewUrl,
    model: aiModel,
    effort: aiEffort,
  });

  function openWorkflow(id: string, opts?: { openDiff?: boolean }) {
    forceDevWorkflows();
    setActiveId(id);
    setChatOpen(true);
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, unread: 0 } : w)),
    );

    if (opts?.openDiff) {
      const wf = workflows.find((w) => w.id === id);
      const diff = [...(wf?.messages ?? [])]
        .reverse()
        .find((m): m is DiffMsg => m.type === "diff");
      if (diff) {
        setActiveDiff(diff);
        setActivePath(diff.path);
        setDiffSnapPoint(isMobile ? 0.85 : 1);
        setDiffsOpen(true);
      }
    }
  }

  function handleImportStart({
    workflowId,
    owner,
    repo,
  }: {
    workflowId: string;
    owner: string;
    repo: string;
  }) {
    const newWorkflow: Workflow = {
      id: workflowId,
      name: repo,
      initials: repo.slice(0, 2).toUpperCase(),
      avatarClass: "bg-emerald-200 text-emerald-900",
      repo: `${owner}/${repo}`,
      status: "working",
      messages: [
        {
          id: 1,
          type: "agent-status",
          text: `Cloning ${owner}/${repo}…`,
          action: "cloning",
          path: repo,
          thinking: `Fetching ${owner}/${repo} into a fresh sandbox workspace.`,
          streaming: true,
          time: nowTime(),
        },
      ],
      workspace: [],
    };
    setWorkflows((prev) => [...prev, newWorkflow]);
    openWorkflow(workflowId);

    const repoFullName = `${owner}/${repo}`;
    setProjects((prev) => {
      const existing = prev.find(
        (p) => p.id === workflowId || p.repo === repoFullName,
      );
      if (existing) {
        return prev.map((p) =>
          p.id === existing.id
            ? {
                ...p,
                id: workflowId,
                workflowIds: [...new Set([...p.workflowIds, workflowId])],
                runConfig: {
                  kind: "railway",
                  railway: { githubRepo: repoFullName },
                },
              }
            : p,
        );
      }
      return [
        ...prev,
        {
          id: workflowId,
          name: repo,
          repo: repoFullName,
          workflowIds: [workflowId],
          runConfig: { kind: "railway", railway: { githubRepo: repoFullName } },
        },
      ];
    });
  }

  async function handleImportSuccess(data: {
    workflowId: string;
    name: string;
    repo: string;
    status: "idle";
  }) {
    const files = await utils.workflow.getSandboxFiles
      .fetch({ workflowId: data.workflowId })
      .then((r) => r.files)
      .catch(() => []); // ponytail: file listing is best-effort, workflow still usable without it

    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === data.workflowId
          ? {
              ...w,
              status: "idle",
              workspace: files,
              messages: [
                ...w.messages,
                {
                  id: nextMsgId(w.messages),
                  type: "text",
                  from: "agent",
                  text: `Cloned ${data.repo} — ${files.length} files ready.`,
                  time: nowTime(),
                },
              ],
            }
          : w,
      ),
    );
  }

  function handleImportError(workflowId: string, message: string) {
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === workflowId
          ? {
              ...w,
              status: "idle",
              messages: [
                ...w.messages,
                {
                  id: nextMsgId(w.messages),
                  type: "text",
                  from: "agent",
                  text: message,
                  time: nowTime(),
                },
              ],
            }
          : w,
      ),
    );
  }

  function handleImportFromComposer(repoFullName?: string) {
    if (!repoFullName) {
      setImportOpen(true);
      return;
    }
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      setImportOpen(true);
      return;
    }
    const existingIds = workflows.map((w) => w.id);
    const workflowId = dedupeId(slugify(`${owner}-${repo}`), existingIds);
    handleImportStart({ workflowId, owner, repo });
    importRepo.mutate(
      { repoUrl: repoFullName, existingIds },
      {
        onSuccess: (data) => {
          void handleImportSuccess(data);
        },
        onError: (err) => handleImportError(workflowId, err.message),
      },
    );
  }

  /** research/workspace/create modes route to their own harness, not the coding one. */
  async function handleModeHarness(mode: "research" | "workspace" | "create", promptText: string) {
    setCreatingFromPrompt(true);
    const existing = active?.repo === mode ? active : null;
    const id = existing?.id ?? `${mode}-${Date.now()}`;
    const nextMsgId = (existing?.messages.at(-1)?.id ?? 0) + 1;
    const userMsg: Msg = {
      id: nextMsgId,
      type: "text",
      from: "me",
      text: promptText,
      time: nowTime(),
    };

    if (existing) {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, status: "working", messages: [...w.messages, userMsg] }
            : w,
        ),
      );
    } else {
      setWorkflows((prev) => [
        ...prev,
        {
          id,
          name: promptText.slice(0, 32),
          initials: promptText.slice(0, 2).toUpperCase() || "AI",
          avatarClass: "bg-sky-200 text-sky-900",
          repo: mode,
          status: "working",
          messages: [userMsg],
          workspace: [],
        },
      ]);
      // Stay in this mode's own chrome — do NOT call openWorkflow(), which
      // forces mode="dev"/view="workflows" (that's the dev Build panel).
      setActiveId(id);
    }

    const appendReply = (reply: Msg) => {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, status: "idle", messages: [...w.messages, reply] }
            : w,
        ),
      );
    };

    try {
      if (mode === "create") {
        const { image } = await runImage.mutateAsync({ prompt: promptText });
        appendReply({
          id: nextMsgId + 1,
          type: "image",
          prompt: promptText,
          src: image,
          time: nowTime(),
        });
      } else {
        const history: { role: "user" | "assistant"; content: string }[] = (
          existing?.messages ?? []
        )
          .filter((m): m is TextMsg => m.type === "text")
          .map((m) => ({
            role: m.from === "me" ? "user" : "assistant",
            content: m.text,
          }));
        const { reply } = await runChat.mutateAsync({ mode, prompt: promptText, history });
        appendReply({
          id: nextMsgId + 1,
          type: "text",
          from: "agent",
          text: reply,
          time: nowTime(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendReply({
        id: nextMsgId + 1,
        type: "text",
        from: "agent",
        text: `Couldn't get a response: ${message}`,
        time: nowTime(),
      });
    } finally {
      setCreatingFromPrompt(false);
    }
  }

  async function handleCreateFromPrompt(
    promptText: string,
    opts?: { model: ModelId; effort: EffortId },
  ) {
    if (opts?.model) setAiModel(opts.model);
    if (opts?.effort) setAiEffort(opts.effort);

    if (mode === "research" || mode === "workspace" || mode === "create") {
      return handleModeHarness(mode, promptText);
    }

    setCreatingFromPrompt(true);
    const optimisticId = `pending-${Date.now()}`;
    const shortName = promptText.slice(0, 32);

    setWorkflows((prev) => [
      ...prev,
      {
        id: optimisticId,
        name: shortName,
        initials: shortName.slice(0, 2).toUpperCase() || "AP",
        avatarClass: "bg-sky-200 text-sky-900",
        repo: "virtual",
        status: "working",
        messages: [
          {
            id: 1,
            type: "text",
            from: "me",
            text: promptText,
            time: nowTime(),
          },
          {
            id: 2,
            type: "agent-status",
            text: "Creating virtual workspace…",
            action: "spawning",
            path: "sandbox",
            thinking:
              "Provisioning a virtual workspace and spinning up the Next scaffold sandbox.",
            streaming: true,
            time: nowTime(),
          },
        ],
        workspace: [],
      },
    ]);
    openWorkflow(optimisticId);

    try {
      const data = await createFromPrompt.mutateAsync({
        prompt: promptText,
        existingIds: workflows
          .map((w) => w.id)
          .filter((id) => !id.startsWith("pending-")),
      });

      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === optimisticId
            ? {
                ...w,
                id: data.workflowId,
                name: data.name,
                initials: data.name.slice(0, 2).toUpperCase(),
                repo: "virtual",
                status: "working",
                workspace: data.files,
                messages: [
                  {
                    id: 1,
                    type: "text",
                    from: "me",
                    text: promptText,
                    time: nowTime(),
                  },
                  {
                    id: 2,
                    type: "text",
                    from: "agent",
                    text: data.previewUrl
                      ? `Scaffold ready (${data.contentRootHash.slice(0, 8)}…). Preview at ${data.previewUrl}`
                      : `Scaffold ready (${data.contentRootHash.slice(0, 8)}…). Building your app on the Next scaffold…`,
                    time: nowTime(),
                  },
                  {
                    id: 3,
                    type: "agent-status",
                    text: "Building page.tsx…",
                    action: "building",
                    path: "page.tsx",
                    thinking:
                      "Replacing the scaffold homepage with a working UI for the request.",
                    streaming: true,
                    time: nowTime(),
                  },
                ],
              }
            : w,
        ),
      );
      activeIdRef.current = data.workflowId;
      setActiveId(data.workflowId);
      if (data.previewUrl) setPreviewUrl(data.previewUrl);

      setProjects((prev) => [
        ...prev.filter((p) => p.id !== data.workflowId),
        {
          id: data.workflowId,
          name: data.name,
          repo: "virtual",
          workflowIds: [data.workflowId],
          runConfig: { kind: "none" },
        },
      ]);

      const model = opts?.model ?? aiModel;
      const effort = opts?.effort ?? aiEffort;

      const infraStatus = await utils.workflow.isEnabled.fetch();
      if (!infraStatus.enabled) {
        setWorkflows((prev) =>
          prev.map((w) =>
            w.id === data.workflowId
              ? {
                  ...w,
                  status: "idle",
                  messages: [
                    ...w.messages.filter((m) => m.type !== "agent-status"),
                    {
                      id: Date.now(),
                      type: "text",
                      from: "agent",
                      text: "Generation failed — agent not configured. Send a message to retry once AGENT_HARNESS_URL and SANDBOX_ORCHESTRATOR_URL are set.",
                      time: nowTime(),
                    },
                  ],
                }
              : w,
          ),
        );
      } else {
        void runAgentMutation.mutateAsync({
          workflowId: data.workflowId,
          prompt: wrapNextScaffoldBootstrapPrompt(promptText),
          // Reuse status id 3 so upsert-status mutates the optimistic WorkingCard
          messageIdStart: 2,
          model,
          effort,
          files: data.files.map((f) => ({ path: f.path, contents: f.contents })),
          omitUserMessage: true,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === optimisticId
            ? {
                ...w,
                status: "idle",
                messages: [
                  {
                    id: 1,
                    type: "text",
                    from: "me",
                    text: promptText,
                    time: nowTime(),
                  },
                  {
                    id: 2,
                    type: "text",
                    from: "agent",
                    text: `Couldn't create workspace: ${message}`,
                    time: nowTime(),
                  },
                ],
              }
            : w,
        ),
      );
    } finally {
      setCreatingFromPrompt(false);
    }
  }

  function switchView(v: ShellView) {
    setView(v);
    setChatOpen(false);
  }

  // Signed-out Dev keeps the Projects landing; Work/New reuse the same composer.
  const showProjectsLanding =
    mode === "dev" && (view === "projects" || !signedIn);
  const showWorkspaceWork = signedIn && mode === "workspace" && view === "work";
  const showResearchNew = signedIn && mode === "research" && view === "new";
  const showCreateNew = signedIn && mode === "create" && view === "new";
  const showHomeComposer =
    showProjectsLanding ||
    showWorkspaceWork ||
    showResearchNew ||
    showCreateNew;
  const activeModeThread =
    (mode === "research" || mode === "workspace" || mode === "create") &&
    active?.repo === mode
      ? active
      : null;
  const composerSurface =
    mode === "workspace"
      ? "workspace"
      : mode === "research"
        ? "research"
        : mode === "create"
          ? "create"
          : "dev";
  const showDevWorkflows = signedIn && mode === "dev" && view === "workflows";

  function openDiff(messageId: number) {
    if (!active) return;
    const msg = active.messages.find((m) => m.id === messageId);
    if (msg?.type !== "diff") return;
    setActiveDiff(msg);
    setActivePath(msg.path);
    setDiffSnapPoint(isMobile ? 0.85 : 1);
    setDiffsOpen(true);
  }

  function openWorkspaceFromPrompt() {
    const latestDiff = diffs.at(-1);
    if (latestDiff) {
      setActiveDiff(latestDiff);
      setActivePath(latestDiff.path);
    }
    setWorkspaceOpen(true);
  }

  const runLocked =
    active?.status === "working" ||
    agent.isStopping ||
    createRunStopping ||
    agent.isRunPending ||
    runAgentMutation.isPending;
  const showStop = Boolean(runLocked);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    if (runLocked) return;
    setDraft("");
    agent.run(text);
  }

  function stopAgent() {
    if (agent.isStopping || createRunStopping) return;
    agent.cancel();
    if (runAgentMutation.isPending) {
      createRunStopRef.current = true;
      setCreateRunStopping(true);
      handleAgentEvent({
        kind: "upsert-status",
        message: {
          id: Date.now(),
          type: "agent-status",
          text: "Stopping…",
          action: "stopping",
          thinking:
            "Waiting for the in-flight run to finish. Send stays locked until then — the sandbox may still be mutating.",
          streaming: true,
          time: nowTime(),
        },
      });
    }
  }

  const totalUnread = workflows.reduce((n, w) => n + (w.unread ?? 0), 0);

  return (
    <div className="bg-background flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      <nav className="bg-sidebar-primary text-sidebar-primary-foreground hidden w-56 shrink-0 flex-col gap-1 px-3 py-4 md:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <StatusBubble badges={bubbleBadges} />
          <ShellModeMenu
            modes={modes}
            mode={mode}
            onModeChange={setMode}
            signedIn={signedIn}
            label={accountLabel}
            image={session?.user?.image}
            initials={accountInitials}
            provider={session?.provider}
            hasGitHub={Boolean(session?.hasGitHub)}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {!signedIn && mode === "dev" ? (
            <>
              {LANDING_FEATURES.map((feature) => (
                <FeatureRailButton
                  key={feature.id}
                  label={feature.label}
                  blurb={feature.blurb}
                  active={landingFeature === feature.id}
                  onClick={() => {
                    setLandingFeature(feature.id);
                    switchView("projects");
                  }}
                >
                  <HugeiconsIcon icon={feature.icon} size={18} />
                </FeatureRailButton>
              ))}
              <div className="bg-sidebar-primary-foreground/10 mx-2 my-2 h-px" />
              <p className="text-sidebar-primary-foreground/50 px-3 py-2 text-xs leading-relaxed">
                Sign in to unlock workflows on your projects.
              </p>
            </>
          ) : (
            <>
              {modeDef.nav.map((item) => (
                <RailButton
                  key={item.view}
                  label={item.label}
                  active={view === item.view}
                  badge={
                    item.view === "workflows" && totalUnread > 0
                      ? totalUnread
                      : undefined
                  }
                  onClick={() => switchView(item.view)}
                >
                  <HugeiconsIcon icon={item.icon} size={20} />
                </RailButton>
              ))}

              <div className="bg-sidebar-primary-foreground/10 mx-2 my-2 h-px" />
              <RailButton label="Docs">
                <HugeiconsIcon icon={HelpCircleIcon} size={20} />
              </RailButton>
            </>
          )}
        </div>

        {signedIn || mode !== "dev" ? (
          <div className="mt-auto flex shrink-0 flex-col gap-1.5 pt-3">
            <UpdatesPromoCard />
            <UsageProgressBar budget={budgetQuery.data} />
            <RailButton label="Settings">
              <HugeiconsIcon icon={Settings01Icon} size={20} />
            </RailButton>
          </div>
        ) : null}
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1">
        {showHomeComposer && activeModeThread ? (
          <ModeThreadView
            mode={activeModeThread.repo as "research" | "workspace" | "create"}
            active={activeModeThread}
            sending={creatingFromPrompt}
            onSend={(text) =>
              void handleModeHarness(
                activeModeThread.repo as "research" | "workspace" | "create",
                text,
              )
            }
          />
        ) : showHomeComposer ? (
          <Projects
            surface={composerSurface}
            onImport={handleImportFromComposer}
            onCreateFromPrompt={(p, opts) => void handleCreateFromPrompt(p, opts)}
            creating={creatingFromPrompt}
            featureId={landingFeature}
            onFeatureChange={setLandingFeature}
            model={aiModel}
            effort={aiEffort}
            onModelChange={setAiModel}
            onEffortChange={setAiEffort}
          />
        ) : mode === "dev" && view === "deployments" ? (
          <DeploymentsPanel
            projects={projects}
            onProjectRunResult={(projectId, result) => {
              setProjects((prev) => {
                const idx = prev.findIndex(
                  (p) =>
                    p.id === projectId || p.workflowIds.includes(projectId),
                );
                if (idx === -1) {
                  return [
                    ...prev,
                    {
                      id: projectId,
                      name: projectId,
                      repo: projectId,
                      workflowIds: [projectId],
                      runConfig: { kind: "railway" as const },
                      lastRun: result,
                    },
                  ];
                }
                return prev.map((p, i) =>
                  i === idx ? { ...p, lastRun: result } : p,
                );
              });
            }}
          />
        ) : mode === "dev" && view === "agents" ? (
          <SectionScaffold
            title="Agents"
            description="Specialist agents assigned to your repos — who is working, idle, or waiting on review."
            icon={BotIcon}
            emptyLabel="No agents yet. Import a project to spin up your first one."
          />
        ) : mode === "dev" && view === "integrations" ? (
          <SectionScaffold
            title="Integrations"
            description="Connect external accounts and tools so agents can ship from chat."
            icon={Link01Icon}
            emptyLabel="Browse integrations to connect GitHub or request a tool."
            action={
              <Button onClick={() => setIntegrationsOpen(true)}>
                Browse integrations
              </Button>
            }
          />
        ) : view === "connections" ? (
          <SectionScaffold
            title="Connections"
            description="Link Gmail, Zapier, and other apps so Workspace agents can act on your behalf."
            icon={Link01Icon}
            emptyLabel="No apps connected yet."
          />
        ) : view === "automations" ? (
          <SectionScaffold
            title="Automations"
            description="Recipes that run across your connected apps."
            icon={Settings01Icon}
            emptyLabel="No automations yet."
          />
        ) : view === "activity" ? (
          <SectionScaffold
            title="Activity"
            description="Recent runs from Workspace agents."
            icon={ArrowUpRight01Icon}
            emptyLabel="No activity yet."
          />
        ) : view === "chats" ? (
          <SectionScaffold
            title="Chats"
            description="Conversations with the research agent."
            icon={BubbleChatIcon}
            emptyLabel="No research chats yet."
          />
        ) : view === "research" ? (
          <SectionScaffold
            title="Research"
            description="Deep research threads and briefs."
            icon={Search01Icon}
            emptyLabel="No research threads yet."
          />
        ) : view === "sources" ? (
          <SectionScaffold
            title="Sources"
            description="Docs and links the research agent can cite."
            icon={News01Icon}
            emptyLabel="No sources yet."
          />
        ) : view === "gallery" ? (
          <SectionScaffold
            title="Gallery"
            description="Images you've generated in Create."
            icon={Image01Icon}
            emptyLabel="No images yet. Start from New."
          />
        ) : showDevWorkflows ? (
          <>
            <aside
              className={cn(
                "w-full shrink-0 flex-col md:flex md:w-80 md:border-r",
                chatOpen ? "hidden" : "flex",
              )}
            >
              <header className="flex h-16 items-center justify-between px-4">
                <h1 className="text-lg font-semibold">Projects</h1>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="New project">
                    <HugeiconsIcon icon={Add01Icon} size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Import from GitHub"
                    onClick={() => setImportOpen(true)}
                  >
                    <HugeiconsIcon icon={GitBranchIcon} size={18} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Menu">
                    <HugeiconsIcon icon={MoreVerticalIcon} size={18} />
                  </Button>
                </div>
              </header>
              <div className="px-3 pb-3">
                <div className="relative">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={16}
                    className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
                  />
                  <Input
                    placeholder="Search projects"
                    className="pl-9 text-base md:text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {workflows.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                    No projects yet — import a repo to start.
                  </p>
                ) : (
                  workflows.map((w) => {
                    const last = w.messages[w.messages.length - 1];
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => openWorkflow(w.id)}
                        className={cn(
                          "hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                          w.id === activeId && "bg-muted",
                        )}
                      >
                        <Avatar className="size-11">
                          <AvatarFallback className={w.avatarClass}>
                            {w.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{w.name}</span>
                            {last ? (
                              <span className="text-muted-foreground shrink-0 text-xs">
                                {last.time}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="text-muted-foreground truncate text-sm">
                              {last ? messagePreview(last) : "Empty workflow"}
                            </span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {w.status !== "idle" && (
                                <StatusBadge status={w.status} />
                              )}
                              {w.unread ? (
                                <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-medium">
                                  {w.unread}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                            {w.repo}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Conversation + workspace */}
            {active ? (
            <section
              className={cn(
                "min-w-0 flex-1 flex-col md:flex",
                chatOpen ? "flex" : "hidden",
              )}
            >
              <div className="flex min-h-0 min-w-0 flex-1">
                {/* Chat thread */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 md:gap-3 md:px-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Back to workflows"
                      className="md:hidden"
                      onClick={() => setChatOpen(false)}
                    >
                      <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                    </Button>
                    <Avatar className="size-10">
                      <AvatarFallback className={active.avatarClass}>
                        {active.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-medium">
                        {active.name}
                        <StatusBadge status={active.status} />
                      </div>
                      <div className="text-muted-foreground truncate font-mono text-xs">
                        {active.repo}
                        {previewUrl ? (
                          <>
                            {" · "}
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              sandbox preview
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Show diffs"
                      onClick={() => setDiffsOpen(true)}
                    >
                      <HugeiconsIcon icon={SidebarRight01Icon} size={18} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="More">
                      <HugeiconsIcon icon={MoreVerticalIcon} size={18} />
                    </Button>
                  </header>

                  <Drawer
                    open={diffsOpen}
                    onOpenChange={setDiffsOpen}
                    swipeDirection={isMobile ? "down" : "right"}
                    showSwipeHandle={isMobile}
                    snapPoints={isMobile ? [0.45, 0.85, 1] : undefined}
                    snapPoint={isMobile ? diffSnapPoint : undefined}
                    onSnapPointChange={(point) => {
                      if (point != null) setDiffSnapPoint(point);
                    }}
                  >
                    <DrawerContent
                      className={cn(
                        "flex max-h-none flex-col p-0",
                        isMobile
                          ? "w-full [--drawer-inset:0px] data-[swipe-direction=down]:rounded-t-4xl"
                          : "h-full w-full sm:max-w-md",
                      )}
                    >
                      <DrawerHeader className="relative border-b px-6 pt-6 pb-4 text-left">
                        <DrawerTitle
                          className="hover:text-primary pr-10 text-left leading-snug transition-colors"
                          render={
                            <button
                              type="button"
                              className="inline-flex items-start gap-2 text-left"
                              onClick={openWorkspaceFromPrompt}
                            />
                          }
                        >
                          <span className="min-w-0 flex-1">{prompt}</span>
                          <HugeiconsIcon
                            icon={ArrowUpRight01Icon}
                            size={16}
                            className="text-muted-foreground mt-0.5 shrink-0"
                            aria-hidden
                          />
                          <span className="sr-only">Open in workspace</span>
                        </DrawerTitle>
                        <DrawerDescription className="text-left font-mono text-xs">
                          {active.repo} · {diffs.length}{" "}
                          {diffs.length === 1 ? "diff" : "diffs"}
                        </DrawerDescription>
                        <DrawerClose
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="absolute top-4 right-4"
                              aria-label="Close diffs"
                            />
                          }
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={16} />
                        </DrawerClose>
                      </DrawerHeader>

                      <div className="relative flex min-h-0 flex-1 flex-col">
                        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pb-24">
                          {diffs.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                              No diffs yet — send a message to kick off the
                              agent.
                            </p>
                          ) : (
                            diffs.map((diff) => (
                              <InlineDiffEditor
                                key={diff.id}
                                diff={diff}
                                title={diff.summary}
                                className={cn(
                                  "max-w-none",
                                  activeDiff?.id === diff.id &&
                                    "ring-primary ring-2",
                                )}
                                onOpen={() => {
                                  setActiveDiff(diff);
                                  setActivePath(diff.path);
                                }}
                              />
                            ))
                          )}
                        </div>

                        <div className="pointer-events-none absolute right-4 bottom-4 flex gap-2">
                          {pendingApproval ? (
                            <Button
                              size="icon"
                              className="pointer-events-auto shadow-lg"
                              aria-label="Approve changes"
                              onClick={() => agent.approve(pendingApproval.id)}
                            >
                              <HugeiconsIcon
                                icon={CheckmarkCircle02Icon}
                                size={18}
                              />
                            </Button>
                          ) : null}
                          <Button
                            size="icon"
                            variant="secondary"
                            className="pointer-events-auto shadow-lg"
                            aria-label="Edit in workspace"
                            onClick={openWorkspaceFromPrompt}
                          >
                            <HugeiconsIcon icon={Edit01Icon} size={18} />
                          </Button>
                        </div>
                      </div>

                      <Drawer
                        open={workspaceOpen}
                        onOpenChange={setWorkspaceOpen}
                        swipeDirection={isMobile ? "down" : "right"}
                        showSwipeHandle={isMobile}
                      >
                        <DrawerContent
                          className={cn(
                            "flex flex-col gap-0 p-0",
                            isMobile
                              ? "h-[92dvh] w-full [--drawer-inset:0px] data-[swipe-direction=down]:rounded-t-4xl"
                              : "h-full w-full sm:max-w-2xl",
                          )}
                        >
                          <Workspace
                            files={active.workspace}
                            activePath={activePath}
                            onSelectFile={setActivePath}
                            diff={activeDiff}
                            onClearDiff={() => setActiveDiff(null)}
                            className="min-h-0 flex-1 border-0"
                          />
                          <DrawerClose
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="absolute top-4 right-4 z-10"
                                aria-label="Close workspace"
                              />
                            }
                          >
                            <HugeiconsIcon icon={Cancel01Icon} size={16} />
                          </DrawerClose>
                        </DrawerContent>
                      </Drawer>
                    </DrawerContent>
                  </Drawer>

                  <div className="bg-muted/20 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                    <div className="mx-auto flex max-w-3xl flex-col gap-3">
                      <Marker role="status" className="my-2">
                        <MarkerContent>Workflow · {active.repo}</MarkerContent>
                      </Marker>
                      <MessageList
                        messages={active.messages}
                        isWorking={
                          active.status === "working" ||
                          agent.isStopping ||
                          createRunStopping
                        }
                        onOpenDiff={openDiff}
                        onApprove={agent.approve}
                        onRequestChanges={agent.requestChanges}
                      />
                      <div ref={bottomRef} />
                    </div>
                  </div>

                  <form
                    onSubmit={send}
                    className="flex shrink-0 items-center gap-2 border-t px-4 py-3"
                  >
                    <div className="relative min-w-0 flex-1">
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          agent.isStopping || createRunStopping
                            ? "Stopping… (send locked)"
                            : showStop
                              ? "Agent is working… (stop to send)"
                              : `Message agent · ${active.name}`
                        }
                        className="pr-12 text-base md:text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Escape" && showStop) {
                            e.preventDefault();
                            stopAgent();
                          }
                        }}
                      />
                      {showStop ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          aria-label={
                            agent.isStopping || createRunStopping
                              ? "Stopping"
                              : "Stop agent"
                          }
                          onClick={stopAgent}
                          disabled={agent.isStopping || createRunStopping}
                          className="bg-foreground text-background hover:bg-foreground/90 absolute top-1/2 right-1.5 size-8 -translate-y-1/2 rounded-full disabled:opacity-60"
                        >
                          <HugeiconsIcon icon={SquareIcon} size={12} />
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="icon-sm"
                          aria-label="Send"
                          disabled={!draft.trim() || runLocked}
                          className="absolute top-1/2 right-1.5 size-8 -translate-y-1/2 rounded-full bg-slate-300 text-black hover:bg-slate-300/80 disabled:opacity-40"
                        >
                          <HugeiconsIcon
                            icon={SentIcon}
                            size={14}
                            className="text-black"
                          />
                        </Button>
                      )}
                    </div>
                  </form>

                </div>
              </div>
            </section>
            ) : null}
          </>
        ) : null}
      </main>

      {!(mode === "dev" && view === "workflows" && chatOpen) && (
        <nav className="bg-sidebar-primary text-sidebar-primary-foreground flex shrink-0 items-center gap-2 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <StatusBubble badges={bubbleBadges} />
          <button
            type="button"
            onClick={() => setAccountDrawerOpen(true)}
            className="hover:bg-sidebar-primary-foreground/10 flex min-w-0 flex-1 items-center gap-1 rounded-xl px-2 py-1.5 text-left transition-colors"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {modeDef.label}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={14}
              className="text-sidebar-primary-foreground/60 shrink-0"
            />
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="text-sidebar-primary-foreground hover:bg-sidebar-primary-foreground/10 hover:text-sidebar-primary-foreground shrink-0"
            onClick={() => setNavMenuOpen(true)}
          >
            <HugeiconsIcon icon={Menu01Icon} size={20} />
          </Button>
        </nav>
      )}

      <Drawer
        open={accountDrawerOpen}
        onOpenChange={setAccountDrawerOpen}
        swipeDirection="down"
        showSwipeHandle
      >
        <DrawerContent className="max-h-[85dvh] md:hidden">
          <DrawerHeader className="text-left">
            <DrawerTitle>{modeDef.label}</DrawerTitle>
            <DrawerDescription className="sr-only">
              Mode and account
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-3 pb-6">
            <ShellModeDrawerBody
              modes={modes}
              mode={mode}
              onModeChange={setMode}
              signedIn={signedIn}
              label={accountLabel}
              image={session?.user?.image}
              initials={accountInitials}
              provider={session?.provider}
              hasGitHub={Boolean(session?.hasGitHub)}
              onActionComplete={() => setAccountDrawerOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={navMenuOpen}
        onOpenChange={setNavMenuOpen}
        swipeDirection="down"
        showSwipeHandle
      >
        <DrawerContent className="max-h-[85dvh] md:hidden">
          <DrawerHeader className="text-left">
            <DrawerTitle>Menu</DrawerTitle>
            <DrawerDescription className="sr-only">
              Navigation menu
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex max-h-[min(70dvh,28rem)] flex-col gap-1 overflow-y-auto px-3 pb-6">
            {!signedIn && mode === "dev" ? (
              <>
                {LANDING_FEATURES.map((feature) => (
                  <MobileFeatureItem
                    key={feature.id}
                    label={feature.label}
                    blurb={feature.blurb}
                    active={landingFeature === feature.id}
                    onClick={() => {
                      setLandingFeature(feature.id);
                      switchView("projects");
                      setNavMenuOpen(false);
                    }}
                  >
                    <HugeiconsIcon icon={feature.icon} size={18} />
                  </MobileFeatureItem>
                ))}
              </>
            ) : (
              <>
                {modeDef.nav.map((item) => (
                  <MobileMenuItem
                    key={item.view}
                    label={item.label}
                    active={view === item.view}
                    badge={
                      item.view === "workflows" && totalUnread > 0
                        ? totalUnread
                        : undefined
                    }
                    onClick={() => {
                      switchView(item.view);
                      setNavMenuOpen(false);
                    }}
                  >
                    <HugeiconsIcon icon={item.icon} size={20} />
                  </MobileMenuItem>
                ))}

                <div className="bg-border my-2 h-px" />
                <MobileMenuItem
                  label="Docs"
                  onClick={() => setNavMenuOpen(false)}
                >
                  <HugeiconsIcon icon={HelpCircleIcon} size={20} />
                </MobileMenuItem>
                <div className="bg-sidebar-primary text-sidebar-primary-foreground mt-3 flex flex-col gap-1.5 rounded-2xl p-2">
                  <UpdatesPromoCard />
                  <UsageProgressBar budget={budgetQuery.data} />
                </div>
                <MobileMenuItem
                  label="Settings"
                  onClick={() => setNavMenuOpen(false)}
                >
                  <HugeiconsIcon icon={Settings01Icon} size={20} />
                </MobileMenuItem>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <ImportRepoDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingIds={workflows.map((w) => w.id)}
        onImportStart={handleImportStart}
        onImportSuccess={handleImportSuccess}
        onImportError={handleImportError}
      />

      <IntegrationsSheet
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
        hasGitHub={Boolean(session?.hasGitHub)}
      />
    </div>
  );
}

function StatusBubble({ badges }: { badges: BubbleBadge[] }) {
  const shown = badges.slice(0, 2);
  const label =
    shown.length > 0
      ? shown.map((b) => BUBBLE_BADGE[b].label).join(", ")
      : "All clear";

  return (
    <div
      className="relative size-9 shrink-0"
      role="status"
      aria-label={label}
      title={label}
    >
      <div
        className={cn(
          "bg-sidebar-primary-foreground/15 flex size-9 items-center justify-center overflow-hidden rounded-full ring-2 ring-sidebar-primary-foreground/20",
          badges.includes("working") && "animate-pulse",
        )}
      >
        <Image
          src="/manycat-logo.png"
          alt=""
          width={28}
          height={28}
          className="size-7"
        />
      </div>
      {shown.map((badge, i) => {
        const meta = BUBBLE_BADGE[badge];
        return (
          <span
            key={badge}
            className={cn(
              "absolute flex size-4 items-center justify-center rounded-full shadow-sm ring-2 ring-sidebar-primary",
              meta.className,
              i === 0 ? "-right-0.5 -bottom-0.5" : "-top-0.5 -left-0.5",
            )}
          >
            <HugeiconsIcon icon={meta.icon} size={10} strokeWidth={2.5} />
          </span>
        );
      })}
    </div>
  );
}

function FeatureRailButton({
  label,
  blurb,
  active,
  onClick,
  children,
}: {
  label: string;
  blurb: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground"
          : "text-sidebar-primary-foreground/50 hover:bg-sidebar-primary-foreground/10 hover:text-sidebar-primary-foreground/80",
      )}
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {children}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span
          className={cn(
            "mt-0.5 block text-[11px] leading-snug",
            active
              ? "text-sidebar-primary-foreground/70"
              : "text-sidebar-primary-foreground/40",
          )}
        >
          {blurb}
        </span>
      </span>
    </button>
  );
}

const MODE_THREAD_TITLE: Record<"research" | "workspace" | "create", string> = {
  research: "Chat",
  workspace: "Work",
  create: "Create",
};

/** Chat/Create/Work conversation — stays in its own mode chrome (no dev split-view, no diffs/sandbox). */
function ModeThreadView({
  mode,
  active,
  sending,
  onSend,
}: {
  mode: "research" | "workspace" | "create";
  active: Workflow;
  sending: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = React.useState("");
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [active.messages.length]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
        <Avatar className="size-10">
          <AvatarFallback className={active.avatarClass}>
            {active.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 truncate font-medium">
          {MODE_THREAD_TITLE[mode]} · {active.name}
        </div>
      </header>

      <div className="bg-muted/20 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <MessageList
            messages={active.messages}
            isWorking={sending}
            onOpenDiff={() => undefined}
            onApprove={() => undefined}
            onRequestChanges={() => undefined}
          />
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (!trimmed || sending) return;
          setText("");
          onSend(trimmed);
        }}
        className="border-t p-3 md:p-4"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === "create" ? "Describe an image…" : "Message…"
            }
            className="text-base md:text-sm"
          />
          <Button type="submit" disabled={sending || !text.trim()}>
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

function RailButton({
  label,
  active,
  badge,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground"
          : "text-sidebar-primary-foreground/50 hover:bg-sidebar-primary-foreground/10 hover:text-sidebar-primary-foreground/80",
      )}
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center overflow-visible">
        {children}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {badge != null ? (
        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function formatRailCents(cents: number | null | undefined) {
  if (cents == null) return "∞";
  return `$${(cents / 100).toFixed(0)}`;
}

function UsageProgressBar({
  budget,
}: {
  budget?: {
    plan: string;
    usedCents: number;
    ceilingCents: number | null;
    remainingCents: number | null;
  };
}) {
  const used = budget?.usedCents ?? 0;
  const ceiling = budget?.ceilingCents;
  const pct =
    ceiling != null && ceiling > 0
      ? Math.min(100, Math.round((used / ceiling) * 100))
      : budget
        ? 0
        : 42;
  const label =
    ceiling != null
      ? `${formatRailCents(used)} / ${formatRailCents(ceiling)}`
      : budget
        ? `${formatRailCents(used)} metered`
        : "Usage";

  return (
    <button
      type="button"
      aria-label={`Usage ${pct}%`}
      className="hover:bg-sidebar-primary-foreground/10 flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sidebar-primary-foreground/60 text-xs font-medium">
          Usage
        </span>
        <span className="text-sidebar-primary-foreground/40 text-[11px] tabular-nums">
          {label}
        </span>
      </div>
      <div
        className="bg-sidebar-primary-foreground/10 h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="bg-sidebar-primary-foreground/55 h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

function UpdatesPromoCard() {
  const update = getFeaturedUpdate();
  if (!update) return null;

  const href = updateHref(update);
  const kindLabel = update.kind === "download" ? "Download" : "Update";

  return (
    <Link
      href={href}
      aria-label={`${kindLabel}: ${update.title}`}
      className="group relative flex min-h-[7.5rem] w-full flex-col justify-between overflow-hidden rounded-2xl px-3 py-3 transition-[transform,filter] duration-300 hover:brightness-110"
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(155deg, #f6e7b8 0%, #e8c77a 48%, #d9a84e 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.28] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "120px 120px",
        }}
      />
      <div
        aria-hidden
        className="absolute -top-8 -right-6 size-24 rounded-full bg-white/40 blur-2xl transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1"
      />
      <div className="relative flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#5c4318]/70 uppercase">
          {update.eyebrow}
        </span>
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          size={14}
          className="text-[#5c4318]/50 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        />
      </div>
      <div className="relative mt-auto space-y-1">
        <p className="text-base font-semibold tracking-tight text-[#3d2c0f]">
          {update.title}
        </p>
        <p className="text-[11px] leading-snug text-[#5c4318]/75">
          {update.blurb}
        </p>
      </div>
    </Link>
  );
}

function MobileFeatureItem({
  label,
  blurb,
  active,
  onClick,
  children,
}: {
  label: string;
  blurb: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {children}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
          {blurb}
        </span>
      </span>
    </button>
  );
}

function MobileMenuItem({
  label,
  active,
  badge,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {children}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null ? (
        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
