"use client";

import * as React from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  BotIcon,
  BrowserIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit01Icon,
  HelpCircleIcon,
  Image01Icon,
  Link01Icon,
  Menu01Icon,
  News01Icon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  GearsIcon,
  SidebarRight01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";

import { ManycatLogo } from "@/components/manycat-logo";
import { ThemeDrawerSection, ThemeRailButton } from "@/components/theme-toggle";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  isBudgetExceededError,
  isBudgetExhausted,
} from "@/lib/billing";
import { dedupeId, slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { getFeaturedUpdate, updateHref } from "@/content/updates";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyWorkspacePatch, useAgent, type AgentEvent } from "./agent-sim";
import type { EffortId, ModelId } from "@/lib/ai-models";
import {
  deriveProjectsFromWorkflows,
  initialWorkflows,
  mergeWorkingPaths,
  type AgentStatusMsg,
  type ApprovalMsg,
  type DiffMsg,
  type ImageMsg,
  type LastRunOutcome,
  type Msg,
  type Project,
  type TextMsg,
  type Workflow,
  type WorkflowStatus,
  type WorkScheduleMsg,
} from "./data";
import ImportRepoDialog from "./import-repo";
import IntegrationsSheet from "./integrations-sheet";
import MessageList, { InlineDiffEditor } from "./message-list";
import type { CreateWork, CreateWorkImage } from "./create-studio";
import Projects, {
  EffortSlider,
  LANDING_FEATURES,
  RESEARCH_SUGGESTIONS,
  WORKSPACE_SUGGESTIONS,
  type LandingFeatureId,
} from "./projects";
import DeploymentsPanel from "./deployments-panel";
import SectionScaffold from "./section-scaffold";
import SettingsSheet from "./settings-sheet";
import { getModes, type ShellView } from "./shell-modes";
import { ShellModeDrawerBody, ShellModeMenu } from "./shell-mode-menu";
import { typewriterReveal } from "./typewriter";
import UpgradeLimitDialog from "./upgrade-limit-dialog";
import { useShellUrl } from "./use-shell-url";
import { BuildPreviewDrawer } from "./build-preview-drawer";
import { ChatThreadHeader } from "./chat-thread-header";
import { WorkflowChatMenu } from "./workflow-chat-menu";
import Workspace from "./workspace";
import {
  WorkPlanButton,
  type WorkScheduleCreated,
} from "./work-plan-button";
import { WorkIntelligenceChips } from "./work-intelligence-chips";
import {
  WorkActivityPane,
  WorkAutomationsPane,
  WorkConnectionsPane,
} from "./work-panes";

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
    m.type === "milestone" ||
    m.type === "work-schedule" ||
    m.type === "image"
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
  const router = useRouter();
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
  const [, setChatOpen] = React.useState(false);
  const [diffsOpen, setDiffsOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [diffSnapPoint, setDiffSnapPoint] = React.useState<number | string>(
    0.45,
  );
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [activeDiff, setActiveDiff] = React.useState<DiffMsg | null>(null);
  const [draft, setDraft] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  /** Dot badge on the Preview button: files changed since the user last looked. */
  const [previewUnseen, setPreviewUnseen] = React.useState(false);
  const [previewDeploying, setPreviewDeploying] = React.useState(false);
  const [contentRootHash, setContentRootHash] = React.useState<string | null>(
    null,
  );
  /** Bumps on every workspace patch so Preview iframe remounts optimistically. */
  const [previewEpoch, setPreviewEpoch] = React.useState(0);
  const [importOpen, setImportOpen] = React.useState(false);
  const [integrationsOpen, setIntegrationsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [upgradeLimitOpen, setUpgradeLimitOpen] = React.useState(false);
  const [navMenuOpen, setNavMenuOpen] = React.useState(false);
  const [accountDrawerOpen, setAccountDrawerOpen] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(() =>
    Boolean(modeDef.tools?.some((t) => t.view === view)),
  );
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
  const anyWorking = workflows.some((w) => w.status === "working");
  const sessionsQuery = api.workflow.listSessions.useQuery(undefined, {
    enabled: signedIn,
    staleTime: anyWorking ? 0 : 30_000,
    refetchInterval: anyWorking ? 3000 : false,
  });
  const reconcileRun = api.workflow.reconcileRun.useMutation();
  const runProject = api.project.run.useMutation();
  const clearUnreadMut = api.workflow.clearUnread.useMutation();
  const reconcileInFlight = React.useRef(new Set<string>());
  const budgetQuery = api.project.budget.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 30_000,
  });
  const budgetExhausted = isBudgetExhausted(budgetQuery.data);
  const openUpgradeLimit = React.useCallback(() => {
    setUpgradeLimitOpen(true);
    void utils.project.budget.invalidate();
  }, [utils.project.budget]);
  // Popup when usage crosses the ceiling during this session (not on cold load).
  const wasBudgetExhausted = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!budgetQuery.isSuccess) return;
    if (
      budgetExhausted &&
      wasBudgetExhausted.current === false
    ) {
      setUpgradeLimitOpen(true);
    }
    wasBudgetExhausted.current = budgetExhausted;
  }, [budgetExhausted, budgetQuery.isSuccess]);
  const persistSession = api.workflow.persistSession.useMutation();
  const renameSession = api.workflow.renameSession.useMutation();
  const deleteSession = api.workflow.deleteSession.useMutation();
  const extractNotes = api.work.extractNotes.useMutation();
  const sharedSessionsQuery = api.work.listSharedSessions.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 30_000,
  });
  const [sessionsHydrated, setSessionsHydrated] = React.useState(false);
  const [activePlanId, setActivePlanId] = React.useState<string | null>(null);
  const [workNotify, setWorkNotify] = React.useState(true);

  function appendWorkSchedule(schedule: WorkScheduleCreated) {
    const wfId = schedule.workflowId;
    setActivePlanId(schedule.planId);
    setActiveId(wfId);
    const scheduleMsg: WorkScheduleMsg = {
      id: Date.now(),
      type: "work-schedule",
      planId: schedule.planId,
      goal: schedule.goal,
      notify: schedule.notify,
      slots: schedule.slots,
      time: nowTime(),
    };
    setWorkflows((prev) => {
      const existing = prev.find((w) => w.id === wfId);
      if (existing) {
        return prev.map((w) =>
          w.id === wfId
            ? { ...w, messages: [...w.messages, scheduleMsg] }
            : w,
        );
      }
      return [
        ...prev,
        {
          id: wfId,
          name: schedule.goal.slice(0, 32) || "Work plan",
          initials: "WP",
          avatarClass: "bg-sky-200 text-sky-900",
          repo: "workspace",
          status: "idle" as const,
          messages: [scheduleMsg],
          workspace: [],
        },
      ];
    });
    void persistSession
      .mutateAsync({
        workflowId: wfId,
        mode: "workspace",
        name: schedule.goal.slice(0, 256) || "Work plan",
        status: "idle",
        messages: [scheduleMsg],
      })
      .catch(() => undefined);
  }

  React.useEffect(() => {
    if (!signedIn || !sessionsQuery.data || sessionsHydrated) return;
    const restored: Workflow[] = sessionsQuery.data.map((s) => {
      const name = s.name || s.id;
      // githubRepo holds owner/repo OR shell markers (create|research|workspace).
      const repo = s.githubRepo ?? "virtual";
      const rawStatus: WorkflowStatus = s.status ?? "idle";
      const agentJobId = s.agentJobId ?? null;
      // Only orphan if status says working but no background job to poll.
      const orphanedWorking = rawStatus === "working" && !agentJobId;
      const baseMessages = (s.messages ?? [])
        .filter(isMsg)
        .filter((m) => m.type !== "agent-status");
      const lastRunOutcome: LastRunOutcome = s.lastRunOutcome ?? null;
      return {
        id: s.id,
        name,
        initials: name.slice(0, 2).toUpperCase() || "AP",
        avatarClass:
          repo === "create"
            ? "bg-violet-200 text-violet-900"
            : repo === "virtual" ||
                repo === "research" ||
                repo === "workspace"
              ? "bg-sky-200 text-sky-900"
              : "bg-emerald-200 text-emerald-900",
        repo,
        status: orphanedWorking ? "idle" : rawStatus,
        agentJobId,
        lastRunOutcome,
        unread: s.unread ?? 0,
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

  // Merge shared Work chats (join-link members) into the local workflow list.
  React.useEffect(() => {
    if (!signedIn || !sharedSessionsQuery.data) return;
    const shared = sharedSessionsQuery.data.filter((s) => s.shared);
    if (shared.length === 0) return;
    setWorkflows((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      for (const s of shared) {
        if (byId.has(s.id)) continue;
        const name = s.name || s.id;
        byId.set(s.id, {
          id: s.id,
          name,
          initials: name.slice(0, 2).toUpperCase() || "WK",
          avatarClass: "bg-amber-200 text-amber-900",
          repo: "workspace",
          status: (s.status as WorkflowStatus) ?? "idle",
          unread: s.unread ?? 0,
          messages: (s.messages ?? []).filter(isMsg),
          workspace: [],
        });
      }
      return [...byId.values()];
    });
  }, [signedIn, sharedSessionsQuery.data]);

  // Deep-link: /?mode=workspace&view=work&session=<id>
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    if (!sessionId) return;
    if (mode !== "workspace") return;
    setActiveId(sessionId);
  }, [mode, sessionsHydrated, sharedSessionsQuery.data]);

  // Soft-sync status/unread from listSessions while background jobs run.
  React.useEffect(() => {
    if (!sessionsHydrated || !sessionsQuery.data) return;
    setWorkflows((prev) => {
      let changed = false;
      const next = prev.map((w) => {
        const s = sessionsQuery.data.find((row) => row.id === w.id);
        if (!s) return w;
        const status: WorkflowStatus = s.status ?? w.status;
        const unread = s.unread ?? w.unread ?? 0;
        const lastRunOutcome: LastRunOutcome =
          s.lastRunOutcome ?? w.lastRunOutcome ?? null;
        const agentJobId = s.agentJobId ?? w.agentJobId ?? null;
        if (
          status === w.status &&
          unread === (w.unread ?? 0) &&
          lastRunOutcome === (w.lastRunOutcome ?? null) &&
          agentJobId === (w.agentJobId ?? null)
        ) {
          return w;
        }
        changed = true;
        return { ...w, status, unread, lastRunOutcome, agentJobId };
      });
      return changed ? next : prev;
    });
  }, [sessionsQuery.data, sessionsHydrated]);

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

  const applyProjectRunResult = React.useCallback(
    (
      projectId: string,
      result: {
        status: "running" | "success" | "failed";
        url?: string;
        log?: string;
        startedAt: string;
        finishedAt?: string;
      },
    ) => {
      setProjects((prev) => {
        const idx = prev.findIndex(
          (p) => p.id === projectId || p.workflowIds.includes(projectId),
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
        return prev.map((p, i) => (i === idx ? { ...p, lastRun: result } : p));
      });
    },
    [],
  );

  const deployWorkflow = React.useCallback(
    async (workflowId: string) => {
      setPreviewDeploying(true);
      const startedAt = new Date().toISOString();
      applyProjectRunResult(workflowId, { status: "running", startedAt });
      try {
        const result = await runProject.mutateAsync({
          workflowId,
          runConfig: { kind: "railway" },
        });
        applyProjectRunResult(workflowId, {
          status: result.status,
          url: result.url,
          log: result.log,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        });
        if (result.status === "failed") {
          toast.error(result.log?.slice(0, 200) ?? "Deploy failed");
        } else if (result.url) {
          toast.success(`Deployed — ${result.url}`);
        }
        void budgetQuery.refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        applyProjectRunResult(workflowId, {
          status: "failed",
          log: message,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        toast.error(message);
      } finally {
        setPreviewDeploying(false);
      }
    },
    [applyProjectRunResult, runProject, budgetQuery],
  );

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
    setPreviewEpoch(0);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset path when switching workflows

  React.useEffect(() => {
    if (mode === "dev" && view === "workflows" && active) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [active?.messages.length, activeId, mode, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchAgentText = React.useCallback(
    (
      workflowId: string,
      messageId: number,
      text: string,
      streaming: boolean,
      extras?: Partial<TextMsg>,
    ) => {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id !== workflowId
            ? w
            : {
                ...w,
                messages: w.messages.map((m) =>
                  m.id === messageId && m.type === "text"
                    ? { ...m, ...extras, text, streaming }
                    : m,
                ),
              },
        ),
      );
    },
    [],
  );

  const streamInAgentText = React.useCallback(
    async (
      workflowId: string,
      message: TextMsg,
      opts?: { finalizeStatus?: WorkflowStatus },
    ) => {
      const full = message.text;
      await typewriterReveal(full, (partial) => {
        patchAgentText(workflowId, message.id, partial, true);
      });
      patchAgentText(workflowId, message.id, full, false, {
        sources: message.sources,
      });
      if (opts?.finalizeStatus) {
        setWorkflows((prev) =>
          prev.map((w) =>
            w.id === workflowId ? { ...w, status: opts.finalizeStatus! } : w,
          ),
        );
      }
    },
    [patchAgentText],
  );

  const handleAgentEvent = React.useCallback((event: AgentEvent, workflowId?: string) => {
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
          case "append": {
            const msg = event.message;
            if (
              msg.type === "text" &&
              msg.from === "agent" &&
              msg.text.length > 0
            ) {
              const placeholder: TextMsg = {
                ...msg,
                text: "",
                streaming: true,
              };
              const workflowId = w.id;
              queueMicrotask(() => {
                void streamInAgentText(workflowId, msg);
              });
              return { ...w, messages: [...w.messages, placeholder] };
            }
            return { ...w, messages: [...w.messages, msg] };
          }
          case "upsert-status": {
            // One live status row per run — replace any prior agent-status,
            // keeping the accumulated file list so WorkingCard can show all edits.
            const prior = w.messages.find(
              (m): m is AgentStatusMsg => m.type === "agent-status",
            );
            const withoutStatus = w.messages.filter(
              (m) => m.type !== "agent-status",
            );
            let paths = mergeWorkingPaths(prior?.paths, prior?.path);
            for (const p of event.message.paths ?? []) {
              paths = mergeWorkingPaths(paths, p);
            }
            paths = mergeWorkingPaths(paths, event.message.path);
            const message: AgentStatusMsg = {
              ...event.message,
              paths,
            };
            return {
              ...w,
              messages: [...withoutStatus, message],
            };
          }
          case "patch-workspace": {
            const workspace = applyWorkspacePatch(
              w.workspace,
              event.path,
              event.contents,
              event.edited,
            );
            if (!event.edited) {
              return { ...w, workspace };
            }
            // Append patched path onto the live WorkingCard file list
            const messages = w.messages.map((m) => {
              if (m.type !== "agent-status") return m;
              return {
                ...m,
                path: event.path,
                paths: mergeWorkingPaths(m.paths ?? (m.path ? [m.path] : []), event.path),
                action: m.action ?? "edited",
                text: m.streaming
                  ? m.text
                  : `Edited ${mergeWorkingPaths(m.paths, event.path)?.length ?? 1} file(s)`,
              };
            });
            return { ...w, workspace, messages };
          }
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

    // Background-job events must not hijack the active view or pop the drawer
    // (an invisibly open drawer marks the whole app inert via Base UI).
    const isActive = !workflowId || workflowId === activeIdRef.current;
    if (event.kind === "patch-workspace" && isActive) {
      setActivePath(event.path);
      setPreviewEpoch((n) => n + 1);
      // Never force the drawer open — signal the update with a dot badge instead.
      if (
        event.path === "app/page.tsx" ||
        event.path === "app/page.jsx" ||
        event.path.endsWith("/page.tsx")
      ) {
        setPreviewUnseen(true);
      }
    }
  }, [streamInAgentText]);

  const handleAgentEventRef = React.useRef(handleAgentEvent);
  handleAgentEventRef.current = handleAgentEvent;

  // Poll harness jobs → apply patches / finish / budget stop.
  React.useEffect(() => {
    if (!signedIn) return;
    const workingIds = workflows
      .filter((w) => w.status === "working" && w.agentJobId)
      .map((w) => w.id);
    if (workingIds.length === 0) return;

    let cancelled = false;
    const tick = () => {
      for (const workflowId of workingIds) {
        if (reconcileInFlight.current.has(workflowId)) continue;
        reconcileInFlight.current.add(workflowId);
        void reconcileRun
          .mutateAsync({ workflowId })
          .then((data) => {
            if (cancelled) return;
            for (const event of data.events ?? []) {
              handleAgentEventRef.current(event, workflowId);
            }
            if (data.contentRootHash) setContentRootHash(data.contentRootHash);
            if (data.outcome === "budget") {
              toast.error("Compute budget exceeded — upgrade to continue", {
                action: {
                  label: "Upgrade",
                  onClick: () => openUpgradeLimit(),
                },
              });
              openUpgradeLimit();
              void budgetQuery.refetch();
            } else if (data.outcome === "failed") {
              toast.error("Agent run failed");
            } else if (data.outcome === "ok") {
              toast.success("Build finished — ready for review");
            }
            if (data.outcome !== "working") {
              setWorkflows((prev) =>
                prev.map((w) =>
                  w.id === workflowId
                    ? {
                        ...w,
                        agentJobId: null,
                        lastRunOutcome:
                          data.outcome === "ok"
                            ? "ok"
                            : data.outcome === "budget"
                              ? "budget"
                              : data.outcome === "failed"
                                ? "failed"
                                : w.lastRunOutcome,
                        unread:
                          data.outcome === "ok" ||
                          data.outcome === "failed" ||
                          data.outcome === "budget"
                            ? 1
                            : w.unread,
                      }
                    : w,
                ),
              );
              void sessionsQuery.refetch();
            }
          })
          .catch(() => {
            /* next poll */
          })
          .finally(() => {
            reconcileInFlight.current.delete(workflowId);
          });
      }
    };

    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll on working set changes
  }, [signedIn, anyWorking, workflows.map((w) => `${w.id}:${w.agentJobId}`).join("|")]);

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
    onSuccess: (data, variables) => {
      if (createRunStopRef.current) {
        finishCreateRunStopped();
        return;
      }
      for (const event of data.events) {
        handleAgentEventRef.current(event);
      }
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
      if (data.jobId) {
        const wfId = variables.workflowId;
        setWorkflows((prev) =>
          prev.map((w) =>
            w.id === wfId
              ? {
                  ...w,
                  status: "working",
                  agentJobId: data.jobId,
                  lastRunOutcome: null,
                }
              : w,
          ),
        );
      }
    },
    onError: (err) => {
      if (createRunStopRef.current) {
        finishCreateRunStopped();
        return;
      }
      if (isBudgetExceededError(err)) openUpgradeLimit();
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
    onContentRootHash: setContentRootHash,
    onJobStarted: (jobId) => {
      const id = activeIdRef.current;
      if (!id) return;
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === id
            ? {
                ...w,
                status: "working",
                agentJobId: jobId,
                lastRunOutcome: null,
              }
            : w,
        ),
      );
    },
    model: aiModel,
    effort: aiEffort,
  });

  function openWorkflow(id: string, opts?: { openDiff?: boolean }) {
    forceDevWorkflows();
    setActiveId(id);
    setChatOpen(true);
    setPreviewOpen(false);
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              unread: 0,
              lastRunOutcome:
                w.lastRunOutcome === "ok" ? null : w.lastRunOutcome,
            }
          : w,
      ),
    );
    if (signedIn) clearUnreadMut.mutate({ workflowId: id });

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
    previewUrl?: string;
    contentRootHash?: string | null;
    files?: { path: string; contents: string }[];
    nextRunKind?: "understand";
    optimisticWorkflowId?: string;
  }) {
    const optimisticId = data.optimisticWorkflowId;
    const files =
      data.files ??
      (await utils.workflow.getSandboxFiles
        .fetch({ workflowId: data.workflowId })
        .then((r) => r.files)
        .catch(() => []));

    setWorkflows((prev) =>
      prev.map((w) => {
        const match =
          w.id === data.workflowId ||
          (optimisticId != null && w.id === optimisticId) ||
          w.repo === data.repo;
        if (!match) return w;
        return {
          ...w,
          id: data.workflowId,
          name: data.name,
          repo: data.repo,
          status: "working" as const,
          workspace: files,
          messages: [
            ...w.messages.filter((m) => m.type !== "agent-status"),
            {
              id: nextMsgId(w.messages),
              type: "text" as const,
              from: "agent" as const,
              text: `Cloned ${data.repo} — ${files.length} files ready. Mapping the codebase…`,
              time: nowTime(),
            },
            {
              id: nextMsgId(w.messages) + 1,
              type: "agent-status" as const,
              text: "Mapping repository…",
              action: "exploring",
              path: "codebase",
              thinking:
                "Building a codebase brief and graph so later edits stay minimal.",
              streaming: true,
              time: nowTime(),
            },
          ],
        };
      }),
    );
    activeIdRef.current = data.workflowId;
    setActiveId(data.workflowId);
    if (data.previewUrl) setPreviewUrl(data.previewUrl);
    if (data.contentRootHash) setContentRootHash(data.contentRootHash);

    const infraStatus = await utils.workflow.isEnabled.fetch().catch(() => ({
      enabled: false,
    }));
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
                    text: "Import ready, but agent infra is not configured — send a message once AGENT_HARNESS_URL is set.",
                    time: nowTime(),
                  },
                ],
              }
            : w,
        ),
      );
      return;
    }

    void runAgentMutation.mutateAsync({
      workflowId: data.workflowId,
      prompt: `Understand repository ${data.repo}`,
      omitUserMessage: true,
      runKind: "understand",
      messageIdStart: 10,
      model: aiModel,
      effort: aiEffort,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });
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
    if (budgetExhausted) {
      openUpgradeLimit();
      return;
    }
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
          void handleImportSuccess({
            ...data,
            optimisticWorkflowId: workflowId,
          });
        },
        onError: (err) => {
          if (isBudgetExceededError(err)) openUpgradeLimit();
          handleImportError(workflowId, err.message);
        },
      },
    );
  }

  /** research/workspace/create modes route to their own harness, not the coding one. */
  async function handleModeHarness(
    mode: "research" | "workspace" | "create",
    promptText: string,
    opts?: { effort: EffortId; deepResearch: boolean },
  ) {
    if (mode === "create" && budgetExhausted) {
      openUpgradeLimit();
      return;
    }
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

    const appendReply = (reply: Msg, status: WorkflowStatus = "idle") => {
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, status, messages: [...w.messages, reply] }
            : w,
        ),
      );
    };

    const persistTurn = (messages: Msg[], status: WorkflowStatus = "idle") => {
      void persistSession
        .mutateAsync({
          workflowId: id,
          mode,
          name: (existing?.name ?? promptText).slice(0, 256),
          status,
          messages,
        })
        .catch((err) => {
          console.warn(
            "[persistSession]",
            err instanceof Error ? err.message : err,
          );
        });
    };

    // Ensure the shell project row exists before the async harness returns.
    persistTurn([userMsg], "working");

    try {
      if (mode === "create") {
        const imageId = `img-${nextMsgId + 1}`;
        const { image, s3Key } = await runImage.mutateAsync({
          prompt: promptText,
          chatId: id,
          imageId,
        });
        const imageMsg: ImageMsg = {
          id: nextMsgId + 1,
          type: "image",
          prompt: promptText,
          src: image,
          s3Key,
          time: nowTime(),
        };
        appendReply(imageMsg, "idle");
        persistTurn([imageMsg], "idle");
      } else {
        const replyId = nextMsgId + 1;
        const deep = mode === "research" && (opts?.deepResearch ?? false);
        const placeholder: TextMsg = {
          id: replyId,
          type: "text",
          from: "agent",
          text: "",
          streaming: true,
          pendingLabel: deep ? "Researching…" : "Thinking…",
          time: nowTime(),
        };
        appendReply(placeholder, "working");

        const history: { role: "user" | "assistant"; content: string }[] = (
          existing?.messages ?? []
        )
          .filter((m): m is TextMsg => m.type === "text")
          .map((m) => ({
            role: m.from === "me" ? "user" : "assistant",
            content: m.text,
          }));
        const chatResult = await runChat.mutateAsync({
          mode,
          prompt: promptText,
          history,
          effort: opts?.effort ?? aiEffort,
          deepResearch: mode === "research" && (opts?.deepResearch ?? false),
          workflowId: mode === "workspace" ? id : undefined,
          timeZone:
            mode === "workspace"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
              : undefined,
        });
        const reply = chatResult.reply;
        const sources =
          "sources" in chatResult ? chatResult.sources : undefined;
        const schedule =
          "schedule" in chatResult ? chatResult.schedule : null;
        const replyMsg: TextMsg = {
          id: replyId,
          type: "text",
          from: "agent",
          text: reply,
          time: nowTime(),
          ...(sources && sources.length > 0 ? { sources } : {}),
        };
        const extra: Msg[] = [replyMsg];
        if (schedule?.slots?.length) {
          const scheduleMsg: WorkScheduleMsg = {
            id: replyId + 1,
            type: "work-schedule",
            planId: schedule.planId,
            goal: schedule.goal,
            notify: schedule.notify,
            slots: schedule.slots,
            time: nowTime(),
          };
          extra.push(scheduleMsg);
          setActivePlanId(schedule.planId);
        }
        await streamInAgentText(id, replyMsg, { finalizeStatus: "idle" });
        if (extra.length > 1) {
          setWorkflows((prev) =>
            prev.map((w) =>
              w.id === id
                ? {
                    ...w,
                    messages: [
                      ...w.messages.filter((m) => m.id !== replyMsg.id),
                      ...extra,
                    ],
                  }
                : w,
            ),
          );
        }
        persistTurn(extra, "idle");
        if (mode === "workspace") {
          void extractNotes
            .mutateAsync({
              workflowId: id,
              messageText: `${promptText}\n${reply}`,
            })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      if (isBudgetExceededError(err)) openUpgradeLimit();
      const message = err instanceof Error ? err.message : String(err);
      const failMsg: TextMsg = {
        id: nextMsgId + 1,
        type: "text",
        from: "agent",
        text: `Couldn't get a response: ${message}`,
        time: nowTime(),
      };
      // Replace empty streaming placeholder if present.
      setWorkflows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w;
          const withoutPlaceholder = w.messages.filter(
            (m) => !(m.type === "text" && m.id === failMsg.id),
          );
          return {
            ...w,
            status: "idle",
            messages: [...withoutPlaceholder, failMsg],
          };
        }),
      );
      persistTurn([failMsg], "idle");
    } finally {
      setCreatingFromPrompt(false);
      void budgetQuery.refetch();
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

    if (budgetExhausted) {
      openUpgradeLimit();
      return;
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
    // Stay on Projects so the composer can morph bottom — open workflow after scaffold.
    activeIdRef.current = optimisticId;
    setActiveId(optimisticId);

    try {
      const data = await createFromPrompt.mutateAsync({
        prompt: promptText,
        existingIds: workflows
          .map((w) => w.id)
          .filter((id) => !id.startsWith("pending-")),
      });

      const tip = data.contentRootHash?.slice(0, 8) ?? "local";
      const scaffoldText = data.previewUrl
        ? `Scaffold ready (${tip}…). Preview at ${data.previewUrl}${
            data.persistedToS3 ? " · saved to S3" : ""
          }`
        : `Scaffold ready (${tip}…). Building your app on the Next scaffold…${
            data.persistedToS3 === false
              ? " (S3 unset — local merkle only)"
              : data.persistedToS3
                ? " · saved to S3"
                : ""
          }`;

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
                    text: "",
                    streaming: true,
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
      if (data.contentRootHash) setContentRootHash(data.contentRootHash);

      await streamInAgentText(data.workflowId, {
        id: 2,
        type: "text",
        from: "agent",
        text: scaffoldText,
        time: nowTime(),
      });
      openWorkflow(data.workflowId);

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
          // Harness build_user_prompt already instructs write_file / scaffold replace.
          prompt: promptText,
          // Reuse status id 3 so upsert-status mutates the optimistic WorkingCard
          messageIdStart: 2,
          model,
          effort,
          files: data.files.map((f) => ({ path: f.path, contents: f.contents })),
          omitUserMessage: true,
          runKind: "oneshot",
        });
      }
    } catch (err) {
      if (isBudgetExceededError(err)) openUpgradeLimit();
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
      void budgetQuery.refetch();
    }
  }

  function switchView(v: ShellView) {
    setView(v);
    setChatOpen(false);
  }

  function handleCreateWorkStart(work: { id: string; title: string }) {
    setWorkflows((prev) => {
      if (prev.some((w) => w.id === work.id)) return prev;
      return [
        ...prev,
        {
          id: work.id,
          name: work.title,
          initials: work.title.slice(0, 2).toUpperCase() || "CR",
          avatarClass: "bg-violet-200 text-violet-900",
          repo: "create",
          status: "working",
          messages: [],
          workspace: [],
        },
      ];
    });
    setActiveId(work.id);
    void persistSession
      .mutateAsync({
        workflowId: work.id,
        mode: "create",
        name: work.title.slice(0, 256),
        status: "working",
        messages: [],
      })
      .catch((err) => {
        console.warn(
          "[persistSession] create start",
          err instanceof Error ? err.message : err,
        );
      });
  }

  function handleCreateWorkImages(
    workId: string,
    revisionId: string,
    images: CreateWorkImage[],
  ) {
    const work = workflows.find((w) => w.id === workId);
    if (!work || images.length === 0) return;
    const startId = (work.messages.at(-1)?.id ?? 0) + 1;
    const imageMsgs: ImageMsg[] = images.map((img, i) => ({
      id: startId + i,
      type: "image",
      prompt: work.name,
      src: img.src,
      s3Key: img.s3Key,
      revisionId,
      time: nowTime(),
    }));
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id !== workId
          ? w
          : {
              ...w,
              status: "idle" as const,
              messages: [...w.messages, ...imageMsgs],
            },
      ),
    );
    void persistSession
      .mutateAsync({
        workflowId: workId,
        mode: "create",
        name: work.name.slice(0, 256),
        status: "idle",
        messages: imageMsgs,
      })
      .catch((err) => {
        console.warn(
          "[persistSession] create images",
          err instanceof Error ? err.message : err,
        );
      });
  }

  function openModeSession(id: string) {
    setActiveId(id);
    setView(mode === "workspace" ? "work" : "new");
    setChatOpen(false);
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              unread: 0,
              lastRunOutcome:
                w.lastRunOutcome === "ok" ? null : w.lastRunOutcome,
            }
          : w,
      ),
    );
    if (signedIn) clearUnreadMut.mutate({ workflowId: id });
  }

  function renameActiveChat(nextName: string) {
    if (!activeId) return;
    const initials = nextName.slice(0, 2).toUpperCase();
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === activeId ? { ...w, name: nextName, initials } : w,
      ),
    );
    void renameSession
      .mutateAsync({ workflowId: activeId, name: nextName.slice(0, 256) })
      .catch((err) => {
        console.warn(
          "[renameSession]",
          err instanceof Error ? err.message : err,
        );
      });
  }

  function deleteActiveChat() {
    if (!activeId) return;
    const id = activeId;
    const wasCreate = mode === "create";
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        workflowIds: p.workflowIds.filter((wid) => wid !== id),
      })),
    );
    setActiveId(null);
    setChatOpen(false);
    switchView(wasCreate ? "new" : "projects");
    void deleteSession.mutateAsync({ workflowId: id }).catch((err) => {
      console.warn(
        "[deleteSession]",
        err instanceof Error ? err.message : err,
      );
    });
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

  const toolViews = modeDef.tools ?? [];
  const toolsActive = toolViews.some((t) => t.view === view);
  React.useEffect(() => {
    if (toolsActive) setToolsOpen(true);
  }, [toolsActive]);

  const buildWorkflows = workflows.filter(
    (w) =>
      w.repo !== "create" &&
      w.repo !== "research" &&
      w.repo !== "workspace",
  );
  const researchChats = workflows.filter((w) => w.repo === "research");
  const workspaceChats = workflows.filter((w) => w.repo === "workspace");
  const createWorks = workflows.filter((w) => w.repo === "create");
  const modeSessions =
    mode === "dev"
      ? buildWorkflows
      : mode === "research"
        ? researchChats
        : mode === "workspace"
          ? workspaceChats
          : mode === "create"
            ? createWorks
            : [];
  const showModeSessions = signedIn && modeSessions.length > 0;
  const homeView = modeDef.home;
  const activeCreateWork: CreateWork | null = React.useMemo(() => {
    if (mode !== "create" || active?.repo !== "create") return null;
    const imageMsgs = active.messages.filter(
      (m): m is ImageMsg => m.type === "image",
    );
    const order: string[] = [];
    const byRev = new Map<string, CreateWorkImage[]>();
    for (const m of imageMsgs) {
      const rid = m.revisionId ?? "rev-1";
      if (!byRev.has(rid)) {
        order.push(rid);
        byRev.set(rid, []);
      }
      byRev.get(rid)!.push({ id: String(m.id), src: m.src, s3Key: m.s3Key });
    }
    return {
      id: active.id,
      title: active.name,
      revisions: order.map((id) => ({
        id,
        images: byRev.get(id) ?? [],
      })),
    };
  }, [mode, active]);

  return (
    <div className="bg-background flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      <nav className="bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 flex-col gap-1 px-3 py-4 md:flex">
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
            onOpenIntegrations={() => setIntegrationsOpen(true)}
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
              <div className="bg-sidebar-foreground/10 mx-2 my-2 h-px" />
              <p className="text-sidebar-foreground/50 px-3 py-2 text-xs leading-relaxed">
                Sign in to unlock workflows on your projects.
              </p>
            </>
          ) : (
            <>
              {modeDef.nav.map((item) => (
                <RailButton
                  key={item.view}
                  label={item.label}
                  active={
                    view === item.view &&
                    (mode === "dev" || !(item.view === homeView && activeId))
                  }
                  onClick={() => {
                    if (item.view === homeView) setActiveId(null);
                    switchView(item.view);
                  }}
                >
                  <HugeiconsIcon icon={item.icon} size={20} />
                </RailButton>
              ))}

              {showModeSessions ? (
                <div className="mt-1 flex flex-col gap-0.5">
                  {modeSessions.map((w) => (
                    <RailButton
                      key={w.id}
                      label={w.name}
                      indented
                      active={
                        mode === "dev"
                          ? view === "workflows" && w.id === activeId
                          : view === homeView && w.id === activeId
                      }
                      indicator={sessionRailIndicator(w)}
                      onClick={() =>
                        mode === "dev"
                          ? openWorkflow(w.id)
                          : openModeSession(w.id)
                      }
                    />
                  ))}
                </div>
              ) : null}

              {toolViews.length > 0 ? (
                <>
                  <div className="bg-sidebar-foreground/10 mx-2 my-2 h-px" />
                  <ToolsRailGroup
                    open={toolsOpen}
                    active={!toolsOpen && toolsActive}
                    onToggle={() => setToolsOpen((o) => !o)}
                  >
                    {toolViews.map((item) => (
                      <RailButton
                        key={item.view}
                        label={item.label}
                        active={view === item.view}
                        indented
                        onClick={() => switchView(item.view)}
                      >
                        <HugeiconsIcon icon={item.icon} size={18} />
                      </RailButton>
                    ))}
                    <RailButton
                      label="Docs"
                      indented
                    >
                      <HugeiconsIcon icon={HelpCircleIcon} size={18} />
                    </RailButton>
                  </ToolsRailGroup>
                </>
              ) : (
                <>
                  <div className="bg-sidebar-foreground/10 mx-2 my-2 h-px" />
                  <RailButton label="Docs">
                    <HugeiconsIcon icon={HelpCircleIcon} size={20} />
                  </RailButton>
                </>
              )}
            </>
          )}
        </div>

        <div className="mt-auto flex shrink-0 flex-col gap-1.5 pt-3">
          {signedIn || mode !== "dev" ? (
            <>
              <UpdatesPromoCard />
              <UsageProgressBar
                budget={budgetQuery.data}
                onClick={() => router.push("/billing")}
              />
            </>
          ) : null}
          <ThemeRailButton />
          {signedIn || mode !== "dev" ? (
            <RailButton label="Settings" onClick={() => setSettingsOpen(true)}>
              <HugeiconsIcon icon={Settings01Icon} size={20} />
            </RailButton>
          ) : null}
        </div>
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1">
        {signedIn &&
        (mode === "research" || mode === "workspace") &&
        (view === "new" || view === "work") ? (
          <ModeThreadView
            mode={mode}
            active={activeModeThread}
            sending={creatingFromPrompt}
            effort={aiEffort}
            onEffortChange={setAiEffort}
            onRename={renameActiveChat}
            onDelete={deleteActiveChat}
            activePlanId={activePlanId}
            notify={workNotify}
            onNotifyChange={setWorkNotify}
            onPlanCreated={(planId, workflowId) => {
              setActivePlanId(planId);
              setActiveId(workflowId);
              setWorkflows((prev) => {
                if (prev.some((w) => w.id === workflowId)) return prev;
                return [
                  ...prev,
                  {
                    id: workflowId,
                    name: "Work plan",
                    initials: "WP",
                    avatarClass: "bg-sky-200 text-sky-900",
                    repo: "workspace",
                    status: "idle" as const,
                    messages: [],
                    workspace: [],
                  },
                ];
              });
            }}
            onSchedule={appendWorkSchedule}
            onSend={(text, opts) =>
              void handleModeHarness(mode, text, opts)
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
            createWork={mode === "create" ? activeCreateWork : null}
            onCreateWorkStart={handleCreateWorkStart}
            onCreateWorkImages={handleCreateWorkImages}
            onRenameCreateWork={renameActiveChat}
            onDeleteCreateWork={deleteActiveChat}
            budgetExhausted={budgetExhausted}
            onUpgradeNeeded={openUpgradeLimit}
            bootThread={
              mode === "dev" &&
              view === "projects" &&
              active &&
              (active.id.startsWith("pending-") || active.repo === "virtual")
                ? { name: active.name, messages: active.messages }
                : null
            }
          />
        ) : mode === "dev" && view === "project-list" ? (
          <ProjectListPanel projects={projects} />
        ) : mode === "dev" && view === "deployments" ? (
          <DeploymentsPanel
            projects={projects}
            onProjectRunResult={applyProjectRunResult}
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
          <WorkConnectionsPane />
        ) : view === "automations" ? (
          <WorkAutomationsPane />
        ) : view === "activity" ? (
          <WorkActivityPane />
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
          <GalleryPanel works={createWorks} onOpenWork={openModeSession} />
        ) : showDevWorkflows ? (
          active ? (
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 min-w-0 flex-1">
                {/* Chat thread */}
                <div className="relative flex min-w-0 flex-1 flex-col">
                  <ChatThreadHeader
                    title={active.name}
                    leading={
                      <div className="bg-background/90 flex items-center rounded-full p-1 shadow-md ring-1 ring-black/5 backdrop-blur-md md:hidden dark:ring-white/10">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Back to new"
                          className="size-8 rounded-full"
                          onClick={() => {
                            setChatOpen(false);
                            switchView("projects");
                          }}
                        >
                          <HugeiconsIcon icon={ArrowLeft01Icon} size={18} />
                        </Button>
                      </div>
                    }
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Show diffs"
                          className="size-8 rounded-full"
                          onClick={() => setDiffsOpen(true)}
                        >
                          <HugeiconsIcon icon={SidebarRight01Icon} size={18} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Preview"
                          className="relative size-8 rounded-full"
                          onClick={() => setPreviewOpen(true)}
                        >
                          <HugeiconsIcon icon={BrowserIcon} size={18} />
                          {previewUnseen ? (
                            <span
                              className="absolute top-0.5 right-0.5 size-2 rounded-full bg-sky-500"
                              aria-hidden
                            />
                          ) : null}
                        </Button>
                        <WorkflowChatMenu
                          workflowId={active.id}
                          name={active.name}
                          onRename={renameActiveChat}
                          onDelete={deleteActiveChat}
                        />
                      </>
                    }
                  />

                  <BuildPreviewDrawer
                    open={previewOpen}
                    onOpenChange={(o) => {
                      setPreviewOpen(o);
                      setPreviewUnseen(false);
                    }}
                    onDeploy={() => void deployWorkflow(active.id)}
                    deploying={previewDeploying}
                    previewUrl={previewUrl}
                    files={active.workspace}
                    rootHash={
                      contentRootHash
                        ? `${contentRootHash}:${previewEpoch}`
                        : `ep:${previewEpoch}`
                    }
                  />

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

                  <div className="bg-muted/20 flex-1 overflow-y-auto px-4 pt-14 pb-4 md:px-6 md:pt-16">
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
          ) : (
            <div className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-center text-sm">
              Select a request from the sidebar to open it.
            </div>
          )
        ) : null}
      </main>

      {!(showDevWorkflows && active) && (
        <nav className="bg-sidebar text-sidebar-foreground flex shrink-0 items-center gap-2 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <StatusBubble badges={bubbleBadges} />
          <button
            type="button"
            onClick={() => setAccountDrawerOpen(true)}
            className="hover:bg-sidebar-foreground/10 flex min-w-0 flex-1 items-center gap-1 rounded-xl px-2 py-1.5 text-left transition-colors"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {modeDef.label}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={14}
              className="text-sidebar-foreground/60 shrink-0"
            />
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground shrink-0"
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
              onOpenIntegrations={() => setIntegrationsOpen(true)}
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
                <div className="bg-border my-2 h-px" />
                <ThemeDrawerSection
                  onActionComplete={() => setNavMenuOpen(false)}
                />
              </>
            ) : (
              <>
                {modeDef.nav.map((item) => (
                  <MobileMenuItem
                    key={item.view}
                    label={item.label}
                    active={
                      view === item.view &&
                      (mode === "dev" || !(item.view === homeView && activeId))
                    }
                    onClick={() => {
                      if (item.view === homeView) setActiveId(null);
                      switchView(item.view);
                      setNavMenuOpen(false);
                    }}
                  >
                    <HugeiconsIcon icon={item.icon} size={20} />
                  </MobileMenuItem>
                ))}

                {showModeSessions ? (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {modeSessions.map((w) => (
                      <MobileMenuItem
                        key={w.id}
                        label={w.name}
                        active={
                          mode === "dev"
                            ? view === "workflows" && w.id === activeId
                            : view === homeView && w.id === activeId
                        }
                        indicator={sessionRailIndicator(w)}
                        onClick={() => {
                          if (mode === "dev") openWorkflow(w.id);
                          else openModeSession(w.id);
                          setNavMenuOpen(false);
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {toolViews.length > 0 ? (
                  <>
                    <div className="bg-border my-2 h-px" />
                    <button
                      type="button"
                      onClick={() => setToolsOpen((o) => !o)}
                      aria-expanded={toolsOpen}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                        toolsActive
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        <HugeiconsIcon icon={GearsIcon} size={20} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">Tools</span>
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        size={14}
                        className={cn(
                          "shrink-0 transition-transform",
                          toolsOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {toolsOpen ? (
                      <div className="flex flex-col gap-0.5 pl-2">
                        {toolViews.map((item) => (
                          <MobileMenuItem
                            key={item.view}
                            label={item.label}
                            active={view === item.view}
                            onClick={() => {
                              switchView(item.view);
                              setNavMenuOpen(false);
                            }}
                          >
                            <HugeiconsIcon icon={item.icon} size={18} />
                          </MobileMenuItem>
                        ))}
                        <MobileMenuItem
                          label="Docs"
                          onClick={() => setNavMenuOpen(false)}
                        >
                          <HugeiconsIcon icon={HelpCircleIcon} size={18} />
                        </MobileMenuItem>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="bg-border my-2 h-px" />
                    <MobileMenuItem
                      label="Docs"
                      onClick={() => setNavMenuOpen(false)}
                    >
                      <HugeiconsIcon icon={HelpCircleIcon} size={20} />
                    </MobileMenuItem>
                  </>
                )}

                <div className="bg-sidebar text-sidebar-foreground mt-3 flex flex-col gap-1.5 rounded-2xl p-2">
                  <UpdatesPromoCard />
                  <UsageProgressBar
                    budget={budgetQuery.data}
                    onClick={() => {
                      setNavMenuOpen(false);
                      router.push("/billing");
                    }}
                  />
                </div>
                <div className="bg-border my-2 h-px" />
                <ThemeDrawerSection
                  onActionComplete={() => setNavMenuOpen(false)}
                />
                <MobileMenuItem
                  label="Settings"
                  onClick={() => {
                    setNavMenuOpen(false);
                    setSettingsOpen(true);
                  }}
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

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        budget={budgetQuery.data}
      />

      <UpgradeLimitDialog
        open={upgradeLimitOpen}
        onOpenChange={setUpgradeLimitOpen}
        budget={budgetQuery.data}
      />

      <IntegrationsSheet
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
        hasGitHub={Boolean(session?.hasGitHub)}
        sessionEmail={session?.user?.email ?? null}
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
          "bg-sidebar-foreground/15 flex size-9 items-center justify-center overflow-hidden rounded-full ring-2 ring-sidebar-foreground/20",
          badges.includes("working") && "animate-pulse",
        )}
      >
        <ManycatLogo alt="" width={28} height={28} className="size-7" />
      </div>
      {shown.map((badge, i) => {
        const meta = BUBBLE_BADGE[badge];
        return (
          <span
            key={badge}
            className={cn(
              "absolute flex size-4 items-center justify-center rounded-full shadow-sm ring-2 ring-sidebar",
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

function GalleryPanel({
  works,
  onOpenWork,
}: {
  works: Workflow[];
  onOpenWork: (id: string) => void;
}) {
  const images = works.flatMap((w) =>
    w.messages
      .filter((m): m is ImageMsg => m.type === "image")
      .map((m) => ({ workId: w.id, title: w.name, src: m.src, id: m.id })),
  );

  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-8 md:px-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <HugeiconsIcon icon={Image01Icon} size={18} />
            <span className="text-xs font-medium tracking-wide uppercase">
              Gallery
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Gallery</h1>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            Images from your Create sessions. Open a work to revise it.
          </p>
        </header>

        {images.length === 0 ? (
          <div className="border-border flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-8 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              No images yet. Start from New.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {images.map((img) => (
              <button
                key={`${img.workId}-${img.id}`}
                type="button"
                onClick={() => onOpenWork(img.workId)}
                className="bg-muted group relative aspect-square overflow-hidden rounded-2xl text-left"
                title={img.title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data URLs from image harness */}
                <img
                  src={img.src}
                  alt={img.title}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectListPanel({ projects }: { projects: Project[] }) {
  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-8 md:px-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <HugeiconsIcon icon={News01Icon} size={18} />
            <span className="text-xs font-medium tracking-wide uppercase">
              Projects
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            Repos and scaffolds that remain after chats are deleted. Start a new
            chat from New anytime.
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="border-border flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-8 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              No projects yet. Create one from New.
            </p>
          </div>
        ) : (
          <ul className="divide-border flex flex-col divide-y rounded-2xl border">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {p.repo}
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {p.workflowIds.length === 0
                    ? "No open chats"
                    : `${p.workflowIds.length} chat${p.workflowIds.length === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
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
          ? "bg-sidebar-foreground/15 text-sidebar-foreground"
          : "text-sidebar-foreground/50 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground/80",
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
              ? "text-sidebar-foreground/70"
              : "text-sidebar-foreground/40",
          )}
        >
          {blurb}
        </span>
      </span>
    </button>
  );
}

const MODE_THREAD_TITLE: Record<"research" | "workspace", string> = {
  research: "Chat",
  workspace: "Work",
};

const MODE_SUGGESTIONS: Record<"research" | "workspace", readonly string[]> = {
  research: RESEARCH_SUGGESTIONS,
  workspace: WORKSPACE_SUGGESTIONS,
};

/** Chat/Work — create-style center→bottom morph; text replies stream in. */
function ModeThreadView({
  mode,
  active,
  sending,
  effort,
  onEffortChange,
  onRename,
  onDelete,
  onSend,
  activePlanId,
  onPlanCreated,
  notify,
  onNotifyChange,
  onSchedule,
}: {
  mode: "research" | "workspace";
  active: Workflow | null;
  sending: boolean;
  effort: EffortId;
  onEffortChange: (next: EffortId) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSend: (text: string, opts: { effort: EffortId; deepResearch: boolean }) => void;
  activePlanId?: string | null;
  onPlanCreated?: (planId: string, workflowId: string) => void;
  notify?: boolean;
  onNotifyChange?: (next: boolean) => void;
  onSchedule?: (schedule: WorkScheduleCreated) => void;
}) {
  const [text, setText] = React.useState("");
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [effortOpen, setEffortOpen] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const draftWorkflowId = React.useRef(`workspace-${Date.now()}`);
  const studio = Boolean(active && active.messages.length > 0);
  const suggestions = MODE_SUGGESTIONS[mode];
  const planWorkflowId = active?.id ?? draftWorkflowId.current;

  const lastMsg = active?.messages.at(-1);
  const lastStreamText = lastMsg?.type === "text" ? lastMsg.text : undefined;

  React.useEffect(() => {
    if (!studio) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [studio, active?.messages.length, lastStreamText]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText("");
    onSend(trimmed, { effort, deepResearch });
  }

  return (
    <section className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {studio && active ? (
        <ChatThreadHeader
          title={active.name}
          actions={
            <WorkflowChatMenu
              workflowId={active.id}
              name={active.name}
              onRename={onRename}
              onDelete={onDelete}
              shareMode={mode === "workspace" ? "join" : "copy"}
            />
          }
        />
      ) : null}

      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-8 transition-[justify-content,gap,padding] duration-500 ease-out md:px-10",
          studio
            ? "justify-end gap-4 overflow-hidden pt-14 pb-6 md:pt-16"
            : "items-center justify-center gap-6 py-8",
        )}
      >
        {studio && active ? (
          <div className="min-h-0 w-full flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-3 py-2">
              <Marker role="status" className="my-2">
                <MarkerContent>
                  {MODE_THREAD_TITLE[mode]} · {active.repo}
                </MarkerContent>
              </Marker>
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
        ) : (
          <header className="flex max-w-xl flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Ready when you are.
            </h1>
          </header>
        )}

        <div
          className={cn(
            "flex w-full flex-col gap-2",
            studio && "relative z-10 shrink-0",
          )}
        >
          {mode === "workspace" ? (
            <WorkIntelligenceChips
              workflowId={active?.id ?? null}
              planId={activePlanId}
              onInsert={(chipText) =>
                setText((prev) => (prev ? `${prev}\n${chipText}` : chipText))
              }
            />
          ) : null}
          <form
            onSubmit={submit}
            className={cn(
              "bg-card flex w-full flex-col rounded-3xl border shadow-sm",
              "focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-3",
            )}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                mode === "research" && deepResearch
                  ? "Ask a question to research…"
                  : studio
                    ? "Message…"
                    : mode === "research"
                      ? "What should we research?"
                      : "What should we automate today?"
              }
              rows={2}
              className="placeholder:text-muted-foreground min-h-16 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none md:text-sm"
              aria-label="Message"
              disabled={sending}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {mode === "workspace" ? (
                  <WorkPlanButton
                    workflowId={planWorkflowId}
                    goalHint={text || active?.name}
                    notify={notify ?? true}
                    onNotifyChange={(next) => onNotifyChange?.(next)}
                    onCreated={(planId) =>
                      onPlanCreated?.(planId, planWorkflowId)
                    }
                    onSchedule={onSchedule}
                  />
                ) : null}
                {mode === "research" ? (
                  <button
                    type="button"
                    onClick={() => setDeepResearch((v) => !v)}
                    aria-pressed={deepResearch}
                    title="Deep research — searches and reads arXiv before replying"
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                      deepResearch
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    )}
                  >
                    <HugeiconsIcon icon={Search01Icon} size={13} />
                    Research
                  </button>
                ) : null}
                <DropdownMenu open={effortOpen} onOpenChange={setEffortOpen}>
                  <DropdownMenuTrigger
                    className="text-muted-foreground hover:text-foreground flex h-7 items-center gap-1 rounded-full px-2.5 text-xs capitalize transition-colors outline-none"
                    aria-label="Select effort"
                  >
                    {effort}
                    <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-56 p-1.5">
                    <EffortSlider
                      value={effort}
                      onChange={(next) => {
                        onEffortChange(next);
                        setEffortOpen(false);
                      }}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                type="submit"
                size="icon"
                className="size-8 shrink-0 rounded-full bg-slate-300 text-black hover:bg-slate-300/80"
                aria-label="Send"
                disabled={sending || !text.trim()}
              >
                <HugeiconsIcon
                  icon={SentIcon}
                  size={14}
                  className="text-black"
                />
              </Button>
            </div>
          </form>

          {!studio ? (
            <ul className="divide-border flex w-full flex-col divide-y">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground w-full py-2 text-left text-sm transition-colors"
                    onClick={() => setText(suggestion)}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ToolsRailGroup({
  open,
  active,
  onToggle,
  children,
}: {
  open: boolean;
  active?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Tools"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-foreground/15 text-sidebar-foreground"
            : "text-sidebar-foreground/50 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground/80",
        )}
      >
        <span className="relative flex size-5 shrink-0 items-center justify-center overflow-visible">
          <HugeiconsIcon icon={GearsIcon} size={20} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">Tools</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className={cn("shrink-0 opacity-70 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="flex flex-col gap-0.5">{children}</div> : null}
    </div>
  );
}

type RailIndicator = "working" | "update" | "error";

function sessionRailIndicator(w: Workflow): RailIndicator | undefined {
  if (w.status === "working") return "working";
  if (w.lastRunOutcome === "failed" || w.lastRunOutcome === "budget") {
    return "error";
  }
  if (
    w.status === "needs-review" ||
    (w.unread != null && w.unread > 0) ||
    w.lastRunOutcome === "ok"
  ) {
    return "update";
  }
  return undefined;
}

function RailSessionMark({ indicator }: { indicator?: RailIndicator }) {
  if (indicator === "working") {
    return (
      <span
        data-rail-status="working"
        className="border-sidebar-foreground/30 size-3.5 shrink-0 animate-spin rounded-full border-2 border-r-transparent"
        aria-label="Working"
      />
    );
  }
  if (indicator === "update") {
    return (
      <span
        data-rail-status="update"
        className="size-2 shrink-0 rounded-full bg-sky-500"
        aria-label="Update ready"
      />
    );
  }
  if (indicator === "error") {
    return (
      <span
        data-rail-status="failure"
        className="size-2 shrink-0 rounded-full bg-red-500"
        aria-label="Run failed"
      />
    );
  }
  return null;
}

function RailButton({
  label,
  active,
  badge,
  indicator,
  indented,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  indicator?: RailIndicator;
  indented?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl py-2 text-sm font-medium transition-colors",
        indented ? "px-3 py-2 pl-4" : "px-3 py-2.5",
        active
          ? "bg-sidebar-foreground/15 text-sidebar-foreground"
          : "text-sidebar-foreground/50 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground/80",
      )}
    >
      {children != null ? (
        <span className="relative flex size-5 shrink-0 items-center justify-center overflow-visible">
          {children}
        </span>
      ) : indicator ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <RailSessionMark indicator={indicator} />
        </span>
      ) : indented ? (
        <span className="size-5 shrink-0" />
      ) : null}
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
  onClick,
}: {
  budget?: {
    plan: string;
    usedCents: number;
    ceilingCents: number | null;
    remainingCents: number | null;
  };
  onClick?: () => void;
}) {
  const used = budget?.usedCents ?? 0;
  const ceiling = budget?.ceilingCents;
  const exhausted = isBudgetExhausted(budget);
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
      onClick={onClick}
      className="hover:bg-sidebar-foreground/10 flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sidebar-foreground/60 text-xs font-medium">
          Usage
        </span>
        <span
          className={cn(
            "text-[11px] tabular-nums",
            exhausted
              ? "text-destructive"
              : "text-sidebar-foreground/40",
          )}
        >
          {label}
        </span>
      </div>
      <div
        className="bg-sidebar-foreground/10 h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            exhausted ? "bg-destructive" : "bg-sidebar-foreground/55",
          )}
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
  indicator,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  indicator?: RailIndicator;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children != null ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          {children}
        </span>
      ) : indicator ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <RailSessionMark indicator={indicator} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null ? (
        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
