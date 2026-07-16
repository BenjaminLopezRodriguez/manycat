"use client";

import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowUpRight01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit01Icon,
  MoreVerticalIcon,
  News01Icon,
  Search01Icon,
  SentIcon,
  SidebarRight01Icon,
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
import { cn } from "@/lib/utils";
import { applyWorkspacePatch, useAgent, type AgentEvent } from "./agent-sim";
import {
  initialWorkflows,
  messagePreview,
  suggestedContacts,
  type ApprovalMsg,
  type DiffMsg,
  type TextMsg,
  type WorkflowStatus,
} from "./data";
import Feed from "./feed";
import MessageList, { InlineDiffEditor } from "./message-list";
import Workspace from "./workspace";

type View = "feed" | "chats";

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

export default function Chat() {
  const isMobile = useIsMobile();
  const [view, setView] = React.useState<View>("feed");
  const [workflows, setWorkflows] = React.useState(initialWorkflows);
  const [activeId, setActiveId] = React.useState(initialWorkflows[0]!.id);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [diffsOpen, setDiffsOpen] = React.useState(false);
  const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
  const [diffSnapPoint, setDiffSnapPoint] = React.useState<number | string>(
    0.45,
  );
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const [activeDiff, setActiveDiff] = React.useState<DiffMsg | null>(null);
  const [invited, setInvited] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const active = workflows.find((w) => w.id === activeId)!;
  const diffs = active.messages.filter((m): m is DiffMsg => m.type === "diff");
  const promptMsg = active.messages.find(
    (m): m is TextMsg => m.type === "text" && m.from === "me",
  );
  const prompt = promptMsg?.text ?? active.name;
  const pendingApproval = active.messages.find(
    (m): m is ApprovalMsg => m.type === "approval" && m.resolved === null,
  );

  React.useEffect(() => {
    const first = active.workspace[0]?.path ?? null;
    setActivePath(first);
    setActiveDiff(null);
    setPreviewUrl(null);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset path when switching workflows

  React.useEffect(() => {
    if (view === "chats") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [active.messages.length, activeId, view]);

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
    workflow: active,
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

  function switchView(v: View) {
    setView(v);
    setChatOpen(false);
  }

  function openDiff(messageId: number) {
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
    if (!text) return;
    if (active.status === "working") return;
    setDraft("");
    agent.run(text);
  }

  const totalUnread = workflows.reduce((n, w) => n + (w.unread ?? 0), 0);

  const navButtons = (
    <>
      <RailButton
        label="Feed"
        active={view === "feed"}
        onClick={() => switchView("feed")}
      >
        <HugeiconsIcon icon={News01Icon} size={20} />
      </RailButton>
      <RailButton
        label="Workflows"
        active={view === "chats"}
        onClick={() => switchView("chats")}
      >
        <span className="relative">
          <HugeiconsIcon icon={BubbleChatIcon} size={20} />
          {totalUnread > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
              {totalUnread}
            </span>
          )}
        </span>
      </RailButton>
    </>
  );

  return (
    <div className="bg-background flex h-dvh w-full flex-col overflow-hidden md:flex-row">
      <nav className="bg-sidebar-primary text-sidebar-primary-foreground hidden w-16 shrink-0 flex-col items-center gap-2 py-4 md:flex">
        <Image
          src="/manycat-logo.png"
          alt="manycat"
          width={40}
          height={40}
          className="mb-4"
        />
        {navButtons}
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1">
        {view === "feed" ? (
          <Feed
            workflows={workflows}
            contacts={suggestedContacts}
            invited={invited}
            onInvite={(id) => setInvited((prev) => [...prev, id])}
            onOpenWorkflow={openWorkflow}
          />
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
                {workflows.map((w) => {
                  const last = w.messages[w.messages.length - 1]!;
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
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {last.time}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="text-muted-foreground truncate text-sm">
                            {messagePreview(last)}
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
                })}
              </div>
            </aside>

            {/* Conversation + workspace */}
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
          </>
        )}
      </main>

      {!(view === "chats" && chatOpen) && (
        <nav className="bg-sidebar-primary text-sidebar-primary-foreground flex shrink-0 items-center justify-around pb-[env(safe-area-inset-bottom)] md:hidden">
          {navButtons}
        </nav>
      )}
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex w-full flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors",
        active
          ? "text-sidebar-primary-foreground"
          : "text-sidebar-primary-foreground/50 hover:text-sidebar-primary-foreground/80",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
          active && "bg-sidebar-primary-foreground/15",
        )}
      >
        {children}
      </span>
      {label}
    </button>
  );
}
