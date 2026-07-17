"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, SentIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProjectsProps = {
  onImport: () => void;
};

export default function Projects({ onImport }: ProjectsProps) {
  const [draft, setDraft] = React.useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Need a repo before chatting — funnel through import.
    onImport();
    setDraft("");
  }

  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-8">
        <h1 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">
          Ready when you are.
        </h1>

        <form
          onSubmit={submit}
          className={cn(
            "bg-muted/50 flex w-full items-center gap-1 rounded-full border px-2 py-1.5 shadow-sm",
            "focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-3",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-9 shrink-0 rounded-full"
            aria-label="Import from project"
            onClick={onImport}
          >
            <HugeiconsIcon icon={Add01Icon} size={20} />
          </Button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What are we building today?"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-1 text-base outline-none md:text-sm"
            aria-label="What are we building today?"
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label="Send"
          >
            <HugeiconsIcon icon={SentIcon} size={16} />
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          Import a GitHub project to get started.
        </p>
      </div>
    </div>
  );
}
