"use client";

import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ArrowUp01Icon } from "@hugeicons/core-free-icons";

type SectionScaffoldProps = {
  title: string;
  description: string;
  icon: typeof ArrowUp01Icon;
  emptyLabel: string;
  action?: ReactNode;
};

export default function SectionScaffold({
  title,
  description,
  icon,
  emptyLabel,
  action,
}: SectionScaffoldProps) {
  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-8 py-8 md:px-10">
        <header className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-2">
            <HugeiconsIcon icon={icon} size={18} />
            <span className="text-xs font-medium tracking-wide uppercase">
              {title}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            {description}
          </p>
        </header>

        <div className="border-border flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-8 py-16 text-center">
          <p className="text-muted-foreground text-sm">{emptyLabel}</p>
          {action}
        </div>
      </div>
    </div>
  );
}
