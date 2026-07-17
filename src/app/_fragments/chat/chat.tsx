"use client";

import * as React from "react";
import Image from "next/image";
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
  CloudUploadIcon,
  CreditCardIcon,
  Edit01Icon,
  GitBranchIcon,
  HelpCircleIcon,
  Link01Icon,
  Menu01Icon,
  MoreVerticalIcon,
  News01Icon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { applyWorkspacePatch, useAgent, type AgentEvent } from "./agent-sim";
import {
  deriveProjectsFromWorkflows,
  initialWorkflows,
  messagePreview,
  type ApprovalMsg,
  type DiffMsg,
  type Project,
  type TextMsg,
  type Workflow,
  type WorkflowStatus,
} from "./data";
import ImportRepoDialog from "./import-repo";
import MessageList, { InlineDiffEditor } from "./message-list";
import Projects from "./projects";
import Workspace from "./workspace";

type View = "feed" | "chats";

const TEAMS = [
  { id: "personal", name: "Personal", initials: "P" },
  { id: "acme", name: "Acme Labs", initials: "AL" },
  { id: "northstar", name: "Northstar", initials: "NS" },
] as const;

/** Icon badges that can pin to the mobile status bubble */
type BubbleBadge = "deploy" | "working" | "review";

const BUBBLE_BADGE: Record<
  BubbleBadge,
  { icon: typeof ArrowUp01Icon; className: string; label: string }
> = {
  deploy: {
    icon: ArrowUp01Icon,
    className: "bg-emerald-500 text-white",
    label: "Deploying",
  },
  working: {
    icon: BotIcon,
    className: "bg-primary text-primary-foreground",
    label: "Agent working",
  },
  review: {
    icon: ArrowUpRight01Icon,
    className: "bg-amber-500 text-white",
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
  const [view, setView] = React.useState<View>("feed");
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
  const [navMenuOpen, setNavMenuOpen] = React.useState(false);
  const [teamDrawerOpen, setTeamDrawerOpen] = React.useState(false);
  const [teamId, setTeamId] = React.useState<string>(TEAMS[0].id);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const utils = api.useUtils();
  const activeTeam = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];

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
    if (view === "chats" && active) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [active?.messages.length, activeId, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAgentEvent = React.useCallback(
    (event: AgentEvent) => {
      setWorkflows((prev) =>
        prev.map((w) => {
          if (w.id !== activeId) return w;
          switch (event.kind) {
            case "status":
              return { ...w, status: event.status };
            case "append":
              return { ...w, messages: [...w.messages, event.message] };
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
    },
    [activeId],
  );

  const agent = useAgent({
    workflow: active ?? EMPTY_WORKFLOW,
    onEvent: handleAgentEvent,
    onPreviewUrl: setPreviewUrl,
  });

  function openWorkflow(id: string, opts?: { openDiff?: boolean }) {
    setView("chats");
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
      const existing = prev.find((p) => p.repo === repoFullName);
      if (existing) {
        return prev.map((p) =>
          p.id === existing.id
            ? { ...p, workflowIds: [...p.workflowIds, workflowId] }
            : p,
        );
      }
      return [
        ...prev,
        {
          id: slugify(repoFullName),
          name: repo,
          repo: repoFullName,
          workflowIds: [workflowId],
          runConfig: { kind: "none" },
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

  function switchView(v: View) {
    setView(v);
    setChatOpen(false);
  }

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

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    if (active.status === "working") return;
    setDraft("");
    agent.run(text);
  }

  const totalUnread = workflows.reduce((n, w) => n + (w.unread ?? 0), 0);

  return (
    <div className="bg-background flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      <nav className="bg-sidebar-primary text-sidebar-primary-foreground hidden w-56 shrink-0 flex-col gap-1 px-3 py-4 md:flex">
        <div className="mb-3 flex items-center gap-2 px-1">
          <StatusBubble badges={bubbleBadges} />
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "hover:bg-sidebar-primary-foreground/10 flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary-foreground/30",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {activeTeam.name}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={14}
                className="text-sidebar-primary-foreground/60 shrink-0"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              <DropdownMenuRadioGroup value={teamId} onValueChange={setTeamId}>
                {TEAMS.map((team) => (
                  <DropdownMenuRadioItem key={team.id} value={team.id}>
                    <Avatar className="size-6">
                      <AvatarFallback className="bg-muted text-[10px] font-semibold">
                        {team.initials}
                      </AvatarFallback>
                    </Avatar>
                    {team.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <RailButton
            label="Projects"
            active={view === "feed"}
            onClick={() => switchView("feed")}
          >
            <HugeiconsIcon icon={News01Icon} size={20} />
          </RailButton>
          <RailButton
            label="Workflows"
            active={view === "chats"}
            badge={totalUnread > 0 ? totalUnread : undefined}
            onClick={() => switchView("chats")}
          >
            <HugeiconsIcon icon={BubbleChatIcon} size={20} />
          </RailButton>
          <RailButton label="Deployments">
            <HugeiconsIcon icon={CloudUploadIcon} size={20} />
          </RailButton>
          <RailButton label="Agents">
            <HugeiconsIcon icon={BotIcon} size={20} />
          </RailButton>
          <RailButton label="Integrations">
            <HugeiconsIcon icon={Link01Icon} size={20} />
          </RailButton>

          <div className="bg-sidebar-primary-foreground/10 mx-2 my-2 h-px" />
          <RailButton label="Usage">
            <HugeiconsIcon icon={CreditCardIcon} size={20} />
          </RailButton>
          <RailButton label="Settings">
            <HugeiconsIcon icon={Settings01Icon} size={20} />
          </RailButton>
          <RailButton label="Docs">
            <HugeiconsIcon icon={HelpCircleIcon} size={20} />
          </RailButton>
        </div>
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1">
        {view === "feed" ? (
          <Projects onImport={() => setImportOpen(true)} />
        ) : (
          <>
            <aside
              className={cn(
                "w-full shrink-0 flex-col md:flex md:w-80 md:border-r",
                chatOpen ? "hidden" : "flex",
              )}
            >
              <header className="flex h-16 items-center justify-between px-4">
                <h1 className="text-lg font-semibold">Workflows</h1>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="New workflow">
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
                    placeholder="Search workflows"
                    className="pl-9 text-base md:text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {workflows.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                    No workflows yet — import a project to start.
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
                        onOpenDiff={openDiff}
                        onApprove={agent.approve}
                        onRequestChanges={agent.requestChanges}
                      />
                      {active.status === "working" && (
                        <div className="text-muted-foreground shimmer px-3.5 text-xs">
                          Agent is working…
                        </div>
                      )}
                      <div ref={bottomRef} />
                    </div>
                  </div>

                  <form
                    onSubmit={send}
                    className="flex shrink-0 items-center gap-2 border-t px-4 py-3"
                  >
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={
                        active.status === "working"
                          ? "Agent is working…"
                          : `Message agent · ${active.name}`
                      }
                      disabled={active.status === "working"}
                      className="flex-1 text-base md:text-sm"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      aria-label="Send"
                      disabled={active.status === "working"}
                    >
                      <HugeiconsIcon icon={SentIcon} size={18} />
                    </Button>
                  </form>

                </div>
              </div>
            </section>
            ) : null}
          </>
        )}
      </main>

      {!(view === "chats" && chatOpen) && (
        <nav className="bg-sidebar-primary text-sidebar-primary-foreground flex shrink-0 items-center gap-2 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
          <StatusBubble badges={bubbleBadges} />
          <button
            type="button"
            onClick={() => setTeamDrawerOpen(true)}
            className="hover:bg-sidebar-primary-foreground/10 flex min-w-0 flex-1 items-center gap-1 rounded-xl px-2 py-1.5 text-left transition-colors"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {activeTeam.name}
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
        open={teamDrawerOpen}
        onOpenChange={setTeamDrawerOpen}
        swipeDirection="down"
        showSwipeHandle
      >
        <DrawerContent className="max-h-[85dvh] md:hidden">
          <DrawerHeader className="text-left">
            <DrawerTitle>Switch team</DrawerTitle>
            <DrawerDescription className="sr-only">
              Choose which team to work in
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex max-h-[min(70dvh,28rem)] flex-col gap-1 overflow-y-auto px-3 pb-6">
            {TEAMS.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => {
                  setTeamId(team.id);
                  setTeamDrawerOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  team.id === teamId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-[10px] font-semibold">
                    {team.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                {team.id === teamId ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    size={16}
                    className="text-primary shrink-0"
                  />
                ) : null}
              </button>
            ))}
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
            <MobileMenuItem
              label="Projects"
              active={view === "feed"}
              onClick={() => {
                switchView("feed");
                setNavMenuOpen(false);
              }}
            >
              <HugeiconsIcon icon={News01Icon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Workflows"
              active={view === "chats"}
              badge={totalUnread > 0 ? totalUnread : undefined}
              onClick={() => {
                switchView("chats");
                setNavMenuOpen(false);
              }}
            >
              <HugeiconsIcon icon={BubbleChatIcon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Deployments"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={CloudUploadIcon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Agents"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={BotIcon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Integrations"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={Link01Icon} size={20} />
            </MobileMenuItem>

            <div className="bg-border my-2 h-px" />
            <MobileMenuItem
              label="Usage"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={CreditCardIcon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Settings"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={Settings01Icon} size={20} />
            </MobileMenuItem>
            <MobileMenuItem
              label="Docs"
              onClick={() => setNavMenuOpen(false)}
            >
              <HugeiconsIcon icon={HelpCircleIcon} size={20} />
            </MobileMenuItem>
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
