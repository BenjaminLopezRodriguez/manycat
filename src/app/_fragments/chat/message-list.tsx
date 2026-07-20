"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Search01Icon,
  SourceCodeIcon,
  TickDouble02Icon,
} from "@hugeicons/core-free-icons";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { cn } from "@/lib/utils";
import type { AgentStatusMsg, DiffMsg, ResearchSource, Msg } from "./data";

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="text-foreground text-sm leading-relaxed wrap-break-word [&:not(:first-child)]:mt-2">
      {children}
    </p>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline underline-offset-2 hover:text-foreground/80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="marker:text-muted-foreground mt-2 list-disc pl-5 text-sm leading-relaxed first:mt-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="marker:text-muted-foreground mt-2 list-decimal pl-5 text-sm leading-relaxed first:mt-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mt-0.5">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-border mt-2 border-l-2 pl-3 text-sm italic first:mt-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto first:mt-0">
      <table className="text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border-b px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-border border-b px-2 py-1">{children}</td>,
  pre: ({ children }) => (
    <pre className="bg-code-background text-code-foreground border-code-border/50 my-2 overflow-x-auto rounded-lg border p-3 font-mono text-[13px] leading-relaxed first:mt-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isFenced = className?.includes("language-");
    if (isFenced) return <code className={className}>{children}</code>;
    return (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-[12px]">
        {children}
      </code>
    );
  },
};

function AgentMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

/** Empty streaming reply — caret, then throb + Thinking… after 200ms. */
function AgentPendingReply({ thinking }: { thinking?: string }) {
  const [waiting, setWaiting] = React.useState(false);

  React.useEffect(() => {
    const t = window.setTimeout(() => setWaiting(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  const label = thinking?.trim() ?? "Thinking…";

  return (
    <div className="flex flex-col gap-2" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "bg-foreground inline-block h-4 w-0.5 rounded-[1px]",
            waiting ? "cursor-throb" : "animate-pulse",
          )}
        />
        {waiting ? (
          <span className="shimmer text-sm font-medium">{label}</span>
        ) : null}
      </div>
    </div>
  );
}

function StreamCaret({ throb }: { throb?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-foreground ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 rounded-[1px] align-middle",
        throb ? "cursor-throb" : "animate-pulse",
      )}
    />
  );
}

function SourcesCard({ sources }: { sources: ResearchSource[] }) {
  return (
    <div className="border-border/60 bg-card w-full max-w-[min(100%,28rem)] overflow-hidden rounded-xl border">
      <div className="border-border/50 text-muted-foreground flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] font-medium">
        <HugeiconsIcon icon={Search01Icon} size={12} />
        Sources
      </div>
      <ul className="divide-border/60 flex flex-col divide-y">
        {sources.map((source, i) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <span className="flex items-start gap-1.5">
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  [{i + 1}]
                </span>
                <span className="text-foreground min-w-0 truncate text-xs font-medium">
                  {source.title}
                </span>
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  size={11}
                  className="text-muted-foreground ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
              {source.snippet ? (
                <span className="text-muted-foreground line-clamp-2 pl-5 text-[11px] leading-snug">
                  {source.snippet}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

type MessageListProps = {
  messages: Msg[];
  /** True while the current run is in flight — shows one live working chip */
  isWorking?: boolean;
  onOpenDiff: (messageId: number) => void;
  onApprove: (messageId: number) => void;
  onRequestChanges: (messageId: number) => void;
};

function fileName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

/** Build a short unified-diff preview centered on the first change */
function previewLines(diff: DiffMsg, max = 8) {
  const before = diff.before
    .split("\n")
    .filter((l, i, a) => !(i === a.length - 1 && l === ""));
  const after = diff.after
    .split("\n")
    .filter((l, i, a) => !(i === a.length - 1 && l === ""));

  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;

  const lines: { kind: "same" | "add" | "del"; text: string; n: number }[] =
    [];

  if (i > 0) {
    lines.push({ kind: "same", text: before[i - 1]!, n: i });
  }

  for (let j = i; j < before.length && lines.length < max; j++) {
    if (j < after.length && before[j] === after[j]) break;
    if (j > i && after.includes(before[j]!)) break;
    lines.push({ kind: "del", text: before[j]!, n: j + 1 });
  }

  for (let j = i; j < after.length && lines.length < max; j++) {
    if (j < before.length && before[j] === after[j] && j > i) {
      lines.push({ kind: "same", text: after[j]!, n: j + 1 });
      break;
    }
    if (j < before.length && before[j] === after[j]) continue;
    lines.push({ kind: "add", text: after[j]!, n: j + 1 });
  }

  if (lines.length === 0) {
    after.slice(0, max).forEach((text, idx) => {
      lines.push({ kind: "same", text, n: idx + 1 });
    });
  }

  return {
    lines: lines.slice(0, max),
    truncated: Math.max(before.length, after.length) > max,
  };
}

export function InlineDiffEditor({
  diff,
  onOpen,
  className,
  title,
}: {
  diff: DiffMsg;
  onOpen: () => void;
  className?: string;
  /** Optional display title above the path (defaults to summary) */
  title?: string;
}) {
  const { lines, truncated } = previewLines(diff);
  const heading = title ?? diff.summary;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group border-code-border/60 w-full max-w-[min(100%,28rem)] overflow-hidden rounded-xl border text-left shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="border-code-border/50 bg-code-background flex flex-col gap-0.5 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={SourceCodeIcon}
            size={14}
            className="text-code-accent shrink-0"
          />
          <span className="text-code-foreground truncate text-[13px] font-medium">
            {heading}
          </span>
          <span className="bg-code-accent/15 text-code-accent ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
            diff
          </span>
        </div>
        <span className="text-code-muted truncate pl-5 font-mono text-[11px]">
          {diff.path}
        </span>
      </div>

      <div
        className="bg-code-background overflow-hidden"
        style={{
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          lineHeight: "20px",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        }}
      >
        <div className="max-h-[160px] overflow-hidden py-1">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "flex whitespace-pre",
                line.kind === "add" && "bg-code-accent/10",
                line.kind === "del" && "bg-code-del/10",
              )}
            >
              <span
                className={cn(
                  "text-code-gutter w-8 shrink-0 pr-2 text-right select-none",
                  line.kind === "add" && "text-code-accent/70",
                  line.kind === "del" && "text-code-del/70",
                )}
              >
                {line.n ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 select-none text-center",
                  line.kind === "add" && "text-code-accent",
                  line.kind === "del" && "text-code-del",
                  line.kind === "same" && "text-code-gutter",
                )}
              >
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 overflow-hidden pr-3 text-ellipsis",
                  line.kind === "add" && "text-code-foreground",
                  line.kind === "del" &&
                    "text-code-foreground/70 decoration-code-del/50 line-through",
                  line.kind === "same" && "text-code-foreground/85",
                )}
              >
                {line.text || " "}
              </span>
            </div>
          ))}
          {truncated && (
            <div className="text-code-muted px-3 py-1 text-[11px]">
              ··· tap to review full diff
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function workingVerb(msg: AgentStatusMsg) {
  if (msg.action?.trim()) return msg.action.trim().toLowerCase();
  const raw = msg.text.split(/\s+/)[0]?.toLowerCase() ?? "editing";
  const verb = raw.replace(/[^a-z]/g, "");
  if (verb === "edited" || verb === "editing" || verb === "building") return verb;
  if (/sandbox/i.test(msg.text)) return "working";
  return verb.length > 0 ? verb : "editing";
}

/** Paths touched this run — prefer accumulated list, fall back to latest path. */
function workingPaths(msg: AgentStatusMsg): string[] {
  if (msg.paths?.length) return msg.paths;
  if (msg.path?.trim()) return [msg.path.trim()];
  const pathMatch = /\b([\w./-]+\.(?:tsx?|jsx?|css|json|md))\b/i.exec(msg.text);
  return pathMatch?.[1] ? [pathMatch[1]] : [];
}

function WorkingCard({
  msg,
  expanded,
  onToggle,
}: {
  msg: AgentStatusMsg;
  expanded: boolean;
  onToggle: () => void;
}) {
  const verb = workingVerb(msg);
  const paths = workingPaths(msg);
  const thinking = msg.thinking?.trim();
  const detail = thinking && thinking.length > 0 ? thinking : null;
  const canExpand = Boolean(detail);
  const hasFiles = paths.length > 0;

  return (
    <div className="flex w-fit max-w-[min(100%,18rem)] flex-col gap-1.5">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        className={cn(
          "border-border/70 bg-card inline-flex w-fit max-w-full flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-left text-xs shadow-sm",
          canExpand && "hover:bg-muted/40 cursor-pointer transition-colors",
          !canExpand && "cursor-default",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              msg.streaming
                ? "bg-primary animate-pulse"
                : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "min-w-0 flex-1 font-medium text-[12px]",
              msg.streaming && "shimmer",
            )}
          >
            {hasFiles
              ? `${verb} ${paths.length} file${paths.length === 1 ? "" : "s"}`
              : msg.text.replace(/…$/, "").slice(0, 36)}
          </span>
          {canExpand && (
            <HugeiconsIcon
              icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
              size={12}
              className="text-muted-foreground shrink-0"
            />
          )}
        </span>

        {hasFiles ? (
          <ul
            className="border-border/50 ml-4 flex flex-col gap-0.5 border-l pl-2"
            aria-label="Files being edited"
          >
            {paths.map((path) => (
              <li
                key={path}
                className={cn(
                  "text-muted-foreground max-w-[14rem] truncate font-mono text-[11px] leading-snug",
                  msg.streaming &&
                    path === paths[paths.length - 1] &&
                    "text-foreground",
                )}
                title={path}
              >
                {fileName(path)}
              </li>
            ))}
          </ul>
        ) : null}
      </button>

      {canExpand && expanded && detail ? (
        <div className="border-border/60 bg-muted/30 text-muted-foreground w-fit max-w-[min(100%,20rem)] rounded-lg border px-3 py-2 text-xs leading-relaxed">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function LiveWorkingIndicator({ msg }: { msg: AgentStatusMsg }) {
  const [expanded, setExpanded] = React.useState(false);

  // New run / action → collapse so the thread doesn't jump (paths can grow live)
  React.useEffect(() => {
    setExpanded(false);
  }, [msg.id, msg.action]);

  return (
    <Message align="start">
      <MessageContent className="items-start">
        <WorkingCard
          msg={msg}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      </MessageContent>
    </Message>
  );
}

export default function MessageList({
  messages,
  isWorking = false,
  onOpenDiff,
  onApprove,
  onRequestChanges,
}: MessageListProps) {
  // Status chips are ephemeral — never archive them into the thread.
  const thread = messages.filter(
    (m): m is Exclude<Msg, AgentStatusMsg> => m.type !== "agent-status",
  );
  const liveStatus = [...messages]
    .reverse()
    .find((m): m is AgentStatusMsg => m.type === "agent-status");
  const showLive =
    Boolean(liveStatus) && (Boolean(liveStatus?.streaming) || isWorking);

  return (
    <>
      {thread.map((m) => {
        switch (m.type) {
          case "text":
            if (m.from === "agent") {
              // Agent owns the canvas — no bubble chrome, just prose in the thread.
              const isPending = Boolean(m.streaming) && !m.text;
              return (
                <Message key={m.id} align="start">
                  <MessageContent className="max-w-none">
                    {isPending ? (
                      <AgentPendingReply thinking={m.pendingLabel} />
                    ) : (
                      <>
                        {m.text ? <AgentMarkdown text={m.text} /> : null}
                        {m.streaming ? <StreamCaret /> : null}
                      </>
                    )}
                    {m.sources && m.sources.length > 0 && !m.streaming ? (
                      <SourcesCard sources={m.sources} />
                    ) : null}
                    {!m.streaming ? (
                      <MessageFooter>{m.time}</MessageFooter>
                    ) : null}
                  </MessageContent>
                </Message>
              );
            }
            return (
              <Message key={m.id} align="end">
                <MessageContent>
                  <Bubble variant="default">
                    <BubbleContent className="max-w-[min(100%,24rem)]">
                      {m.text}
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter className="gap-1">
                    {m.time}
                    <HugeiconsIcon icon={TickDouble02Icon} size={14} />
                  </MessageFooter>
                </MessageContent>
              </Message>
            );

          case "diff":
            return (
              <Message key={m.id} align="start">
                <MessageContent>
                  <InlineDiffEditor
                    diff={m}
                    onOpen={() => onOpenDiff(m.id)}
                  />
                  <MessageFooter>{m.time}</MessageFooter>
                </MessageContent>
              </Message>
            );

          case "approval":
            return (
              <Message key={m.id} align="start">
                <MessageContent>
                  <Bubble variant="tinted">
                    <BubbleContent>
                      <div className="flex flex-col gap-3">
                        <span>{m.text}</span>
                        {m.resolved === null ? (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => onApprove(m.id)}>
                              <HugeiconsIcon
                                icon={CheckmarkCircle02Icon}
                                size={14}
                              />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onRequestChanges(m.id)}
                            >
                              <HugeiconsIcon icon={Cancel01Icon} size={14} />
                              Request changes
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs font-medium opacity-80">
                            {m.resolved ? "Approved" : "Changes requested"}
                          </span>
                        )}
                      </div>
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter>{m.time}</MessageFooter>
                </MessageContent>
              </Message>
            );

          case "milestone":
            return (
              <Message key={m.id} align="start">
                <MessageContent>
                  <Bubble variant="secondary">
                    <BubbleContent className="flex items-start gap-2">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        size={16}
                        className="text-primary mt-0.5 shrink-0"
                      />
                      <span>{m.text}</span>
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter>{m.time}</MessageFooter>
                </MessageContent>
              </Message>
            );

          case "work-schedule":
            return (
              <Message key={m.id} align="start">
                <MessageContent className="max-w-none">
                  <div className="bg-muted/40 flex flex-col gap-2 rounded-2xl border px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">
                        {m.goal || "Goal timeframe"}
                      </p>
                      <span className="text-muted-foreground shrink-0 text-[10px]">
                        {m.notify ? "notifies" : "silent"}
                      </span>
                    </div>
                    <ul className="flex flex-wrap gap-1.5">
                      {m.slots.map((slot) => (
                        <li key={`${slot.at}-${slot.label}`}>
                          <span className="bg-background text-foreground inline-block rounded-lg border px-2 py-1 font-mono text-[11px] leading-none">
                            [prompt {slot.label}]
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <MessageFooter>{m.time}</MessageFooter>
                </MessageContent>
              </Message>
            );

          case "image":
            return (
              <Message key={m.id} align="start">
                <MessageContent>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, Next Image optimizer doesn't apply */}
                  <img
                    src={m.src}
                    alt={m.prompt}
                    className="max-w-[min(100%,24rem)] rounded-xl"
                  />
                  <MessageFooter>{m.time}</MessageFooter>
                </MessageContent>
              </Message>
            );
        }
      })}
      {showLive && liveStatus ? <LiveWorkingIndicator msg={liveStatus} /> : null}
    </>
  );
}
