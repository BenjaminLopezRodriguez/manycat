"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

export function WorkIntelligenceChips({
  workflowId,
  planId,
  onInsert,
}: {
  workflowId: string | null;
  planId?: string | null;
  onInsert: (text: string) => void;
}) {
  const chipsQuery = api.work.listChips.useQuery(
    { workflowId: workflowId! },
    { enabled: Boolean(workflowId), refetchInterval: 30_000 },
  );
  const markUsed = api.work.markChipUsed.useMutation();

  const chips = chipsQuery.data ?? [];
  if (!workflowId || chips.length === 0) return null;

  return (
    <ul className="flex w-full flex-wrap gap-1.5 px-0.5">
      {chips.map((chip) => {
        const initials = (chip.authorLabel ?? chip.authorAccountId ?? "?")
          .slice(0, 2)
          .toUpperCase();
        return (
          <li key={chip.id}>
            <button
              type="button"
              title={chip.text}
              onClick={() => {
                onInsert(chip.text);
                if (planId) {
                  void markUsed.mutateAsync({
                    noteId: chip.id,
                    planId,
                    workflowId,
                  });
                }
              }}
              className={cn(
                "bg-muted/60 hover:bg-muted text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-left text-xs transition-colors",
              )}
            >
              <span
                aria-hidden
                className="bg-foreground/15 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              >
                {initials}
              </span>
              <span className="truncate">{chip.summary}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
