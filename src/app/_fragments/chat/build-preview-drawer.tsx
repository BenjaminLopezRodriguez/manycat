"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
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

import type { WorkspaceFile } from "./data";
import { buildPreviewSrcdoc } from "./preview-srcdoc";

export function BuildPreviewDrawer({
  open,
  onOpenChange,
  previewUrl,
  files,
  rootHash,
  onDeploy,
  deploying,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewUrl: string | null;
  files: WorkspaceFile[];
  /** Remount iframe when workspace merkle tip changes. */
  rootHash?: string | null;
  onDeploy?: () => void;
  deploying?: boolean;
}) {
  const isMobile = useIsMobile();
  const srcdoc = React.useMemo(() => buildPreviewSrcdoc(files), [files]);
  const useLive = Boolean(previewUrl);
  const frameKey = `${useLive ? previewUrl : "srcdoc"}:${rootHash ?? files.length}`;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
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
        <DrawerHeader className="relative border-b px-6 pt-6 pb-4 text-left">
          <DrawerTitle>Preview</DrawerTitle>
          <DrawerDescription className="text-left text-xs">
            {useLive
              ? "Live sandbox — hot reload as the agent writes files."
              : "Approximate view from workspace files (sandbox URL unavailable)."}
          </DrawerDescription>
          {onDeploy ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-14"
              aria-label="Deploy"
              disabled={deploying}
              onClick={onDeploy}
            >
              <HugeiconsIcon
                icon={ArrowUp01Icon}
                size={16}
                className={deploying ? "animate-pulse" : undefined}
              />
            </Button>
          ) : null}
          <DrawerClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4"
                aria-label="Close preview"
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </DrawerClose>
        </DrawerHeader>

        <div className="bg-muted/30 relative min-h-0 flex-1">
          {useLive ? (
            <iframe
              key={frameKey}
              title="Build preview"
              src={
                previewUrl!.includes("?")
                  ? `${previewUrl}&_r=${encodeURIComponent(rootHash ?? "")}`
                  : `${previewUrl}?_r=${encodeURIComponent(rootHash ?? "")}`
              }
              className="size-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <iframe
              key={frameKey}
              title="Build preview"
              srcDoc={srcdoc}
              className="size-full border-0 bg-white"
              sandbox="allow-scripts"
            />
          )}
          {useLive && previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-background/90 text-muted-foreground hover:text-foreground absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs shadow-md ring-1 ring-black/5 backdrop-blur-md"
            >
              Open
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
            </a>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
