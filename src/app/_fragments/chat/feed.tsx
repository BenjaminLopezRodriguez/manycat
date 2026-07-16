"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  SourceCodeIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Contact, MilestoneMsg, Workflow } from "./data";

type FeedProps = {
  workflows: Workflow[];
  contacts: Contact[];
  invited: string[];
  onInvite: (id: string) => void;
  onOpenWorkflow: (id: string, opts?: { openDiff?: boolean }) => void;
};

type Highlight = {
  workflow: Workflow;
  kind: "milestone" | "needs-review";
  message?: MilestoneMsg;
  time: string;
  text: string;
};

export default function Feed({
  workflows,
  contacts,
  invited,
  onInvite,
  onOpenWorkflow,
}: FeedProps) {
  const highlights: Highlight[] = [];

  for (const w of workflows) {
    if (w.status === "needs-review") {
      const diff = [...w.messages].reverse().find((m) => m.type === "diff");
      highlights.push({
        workflow: w,
        kind: "needs-review",
        time: diff?.time ?? "Just now",
        text: diff
          ? `Agent finished a pass on ${diff.path} — review the diff.`
          : "Agent finished a pass — review the diff.",
      });
    }

    for (const m of w.messages) {
      if (m.type === "milestone") {
        highlights.push({
          workflow: w,
          kind: "milestone",
          message: m,
          time: m.time,
          text: m.text,
        });
      }
    }
  }

  return (
    <div className="bg-muted/20 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Your feed</h2>
          <p className="text-muted-foreground text-sm">
            Workflow highlights — only visible to you.
          </p>
        </header>

        <div className="bg-card rounded-2xl border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <HugeiconsIcon
              icon={UserAdd01Icon}
              size={16}
              className="text-muted-foreground"
            />
            Invite collaborators into a workflow
          </div>
          <div className="flex flex-col gap-3">
            {contacts.map((contact) => {
              const isInvited = invited.includes(contact.id);
              return (
                <div key={contact.id} className="flex items-center gap-3">
                  <Avatar className="size-9">
                    <AvatarFallback className={contact.avatarClass}>
                      {contact.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {contact.name}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {contact.mutuals} mutual{" "}
                      {contact.mutuals === 1 ? "contact" : "contacts"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isInvited ? "secondary" : "default"}
                    disabled={isInvited}
                    onClick={() => onInvite(contact.id)}
                  >
                    {isInvited ? "Invited" : "Invite"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <Separator className="my-2" />

        {highlights.length === 0 ? (
          <p className="text-muted-foreground text-center text-sm">
            No highlights yet — kick off a workflow and approve a diff.
          </p>
        ) : (
          highlights.map((h, i) => (
            <article
              key={`${h.workflow.id}-${h.kind}-${h.message?.id ?? i}`}
              className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
            >
              <div className="flex items-center gap-3">
                <Avatar className="size-9">
                  <AvatarFallback className={h.workflow.avatarClass}>
                    {h.workflow.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {h.workflow.name}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {h.workflow.repo} · {h.time}
                  </div>
                </div>
                {h.kind === "milestone" ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    size={16}
                    className="text-primary"
                  />
                ) : (
                  <HugeiconsIcon
                    icon={SourceCodeIcon}
                    size={16}
                    className="text-primary"
                  />
                )}
              </div>
              <p className="text-sm">{h.text}</p>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onOpenWorkflow(h.workflow.id, {
                      openDiff: h.kind === "needs-review",
                    })
                  }
                >
                  <HugeiconsIcon icon={SourceCodeIcon} size={16} />
                  Open workflow
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
