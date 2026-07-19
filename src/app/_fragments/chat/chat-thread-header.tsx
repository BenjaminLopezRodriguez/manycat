import type { ReactNode } from "react";

/** Floating chat title + actions — full-width blur, plain bold name, action pill. */
export function ChatThreadHeader({
  title,
  leading,
  actions,
}: {
  title: string;
  leading?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
      <div className="from-background/80 via-background/50 absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent backdrop-blur-md" />
      <div className="relative flex w-full items-start gap-2 p-3 md:p-4">
        <div className="pointer-events-auto flex w-full min-w-0 items-center gap-2">
          {leading}
          <div className="mr-auto flex min-w-0 max-w-[min(100%,14rem)] items-center px-3.5 py-2 md:max-w-xs">
            <span className="truncate text-sm font-bold">{title}</span>
          </div>
          <div className="bg-background/90 flex shrink-0 items-center gap-0.5 rounded-full p-1 shadow-md ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10">
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
