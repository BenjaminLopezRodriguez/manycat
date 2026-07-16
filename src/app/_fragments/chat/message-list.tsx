"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  SourceCodeIcon,
  SparklesIcon,
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
import type { DiffMsg, Msg } from "./data";

type MessageListProps = {
  messages: Msg[];
  onOpenDiff: (messageId: number) => void;
  onApprove: (messageId: number) => void;
  onRequestChanges: (messageId: number) => void;
};

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

  // One line of context above the change
  if (i > 0) {
    lines.push({ kind: "same", text: before[i - 1]!, n: i });
  }

  // Show removed lines from the divergence point
  for (let j = i; j < before.length && lines.length < max; j++) {
    if (j < after.length && before[j] === after[j]) break;
    // Stop removing once we find a line that exists later in after (heuristic)
    if (j > i && after.includes(before[j]!)) break;
    lines.push({ kind: "del", text: before[j]!, n: j + 1 });
  }

  // Show added lines from the divergence point
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

export default function MessageList({
  messages,
  onOpenDiff,
  onApprove,
  onRequestChanges,
}: MessageListProps) {
  return (
    <>
      {messages.map((m) => {
        switch (m.type) {
          case "text":
            return (
              <Message key={m.id} align={m.from === "me" ? "end" : "start"}>
                <MessageContent>
                  <Bubble variant={m.from === "me" ? "default" : "muted"}>
                    <BubbleContent>{m.text}</BubbleContent>
                  </Bubble>
                  <MessageFooter className="gap-1">
                    {m.time}
                    {m.from === "me" && (
                      <HugeiconsIcon icon={TickDouble02Icon} size={14} />
                    )}
                  </MessageFooter>
                </MessageContent>
              </Message>
            );

          case "agent-status":
            return (
              <Message key={m.id} align="start">
                <MessageContent>
                  <Bubble variant="ghost">
                    <BubbleContent
                      className={cn(
                        "text-muted-foreground flex items-center gap-2 text-xs",
                        m.streaming && "shimmer",
                      )}
                    >
                      <HugeiconsIcon
                        icon={SparklesIcon}
                        size={14}
                        className="text-primary shrink-0"
                      />
                      {m.text}
                    </BubbleContent>
                  </Bubble>
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
        }
      })}
    </>
  );
}
