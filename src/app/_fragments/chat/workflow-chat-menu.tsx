"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Delete02Icon,
  Edit01Icon,
  MoreVerticalIcon,
  Share01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

type WorkflowChatMenuProps = {
  workflowId: string;
  name: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** When set, Share mints a join token for Work chats. */
  shareMode?: "copy" | "join";
};

function shareUrlFor(workflowId: string, joinToken?: string) {
  if (typeof window === "undefined") {
    return joinToken
      ? `/c/${workflowId}?join=${joinToken}`
      : `/c/${workflowId}`;
  }
  const base = `${window.location.origin}/c/${workflowId}`;
  return joinToken ? `${base}?join=${joinToken}` : base;
}

export function WorkflowChatMenu({
  workflowId,
  name,
  onRename,
  onDelete,
  shareMode = "copy",
}: WorkflowChatMenuProps) {
  const isMobile = useIsMobile();
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(name);
  const [copied, setCopied] = React.useState(false);
  const [joinToken, setJoinToken] = React.useState<string | null>(null);
  const mintJoin = api.work.mintJoinToken.useMutation();

  React.useEffect(() => {
    if (renameOpen) setRenameValue(name);
  }, [renameOpen, name]);

  React.useEffect(() => {
    if (!shareOpen) {
      setCopied(false);
      return;
    }
    if (shareMode === "join" && !joinToken && !mintJoin.isPending) {
      void mintJoin
        .mutateAsync({ workflowId })
        .then((r) => setJoinToken(r.token))
        .catch(() => setJoinToken(null));
    }
  }, [shareOpen, shareMode, workflowId, joinToken, mintJoin]);

  const shareUrl = shareUrlFor(workflowId, joinToken ?? undefined);

  function openRename() {
    setActionsOpen(false);
    setRenameOpen(true);
  }

  function openShare() {
    setActionsOpen(false);
    setShareOpen(true);
  }

  function confirmRename() {
    const next = renameValue.trim();
    if (!next || next === name) {
      setRenameOpen(false);
      return;
    }
    onRename(next);
    setRenameOpen(false);
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function confirmDelete() {
    setActionsOpen(false);
    onDelete();
  }

  return (
    <>
      {isMobile ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More"
          className="size-8 rounded-full"
          onClick={() => setActionsOpen(true)}
        >
          <HugeiconsIcon icon={MoreVerticalIcon} size={18} />
        </Button>
      ) : (
        <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
          <DropdownMenuTrigger
            aria-label="More"
            className="hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-full transition-colors outline-none"
          >
            <HugeiconsIcon icon={MoreVerticalIcon} size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={openRename}>
              <HugeiconsIcon icon={Edit01Icon} size={16} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openShare}>
              <HugeiconsIcon icon={Share01Icon} size={16} />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={confirmDelete}>
              <HugeiconsIcon icon={Delete02Icon} size={16} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isMobile ? (
        <Sheet open={actionsOpen} onOpenChange={setActionsOpen}>
          <SheetContent side="bottom" className="rounded-t-4xl">
            <SheetHeader>
              <SheetTitle>Chat</SheetTitle>
              <SheetDescription className="truncate">{name}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-4 pb-6">
              <ActionRow
                icon={Edit01Icon}
                label="Rename"
                onClick={openRename}
              />
              <ActionRow
                icon={Share01Icon}
                label="Share"
                onClick={openShare}
              />
              <ActionRow
                icon={Delete02Icon}
                label="Delete"
                destructive
                onClick={confirmDelete}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {isMobile ? (
        <Sheet open={renameOpen} onOpenChange={setRenameOpen}>
          <SheetContent side="bottom" className="rounded-t-4xl">
            <SheetHeader>
              <SheetTitle>Rename</SheetTitle>
              <SheetDescription>
                Update the title for this chat. The project stays unchanged.
              </SheetDescription>
            </SheetHeader>
            <div className="px-6 pb-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmRename();
                }}
                autoFocus
                className="text-base md:text-sm"
              />
            </div>
            <SheetFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirmRename} disabled={!renameValue.trim()}>
                Save
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename</DialogTitle>
              <DialogDescription>
                Update the title for this chat. The project stays unchanged.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
              }}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirmRename} disabled={!renameValue.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isMobile ? (
        <Sheet open={shareOpen} onOpenChange={setShareOpen}>
          <SheetContent side="bottom" className="rounded-t-4xl">
            <SheetHeader>
              <SheetTitle>Share chat</SheetTitle>
              <SheetDescription>
                {shareMode === "join"
                  ? "Anyone signed in with this link can join this Work chat."
                  : "Anyone with this link can open this chat."}
              </SheetDescription>
            </SheetHeader>
            <div className="px-6">
              <ShareLinkBody
                shareUrl={shareUrl}
                copied={copied}
                onCopy={() => void copyShareLink()}
                loading={shareMode === "join" && !joinToken && mintJoin.isPending}
              />
            </div>
            <SheetFooter>
              <Button onClick={() => setShareOpen(false)}>Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share chat</DialogTitle>
              <DialogDescription>
                {shareMode === "join"
                  ? "Anyone signed in with this link can join this Work chat."
                  : "Anyone with this link can open this chat."}
              </DialogDescription>
            </DialogHeader>
            <ShareLinkBody
              shareUrl={shareUrl}
              copied={copied}
              onCopy={() => void copyShareLink()}
              loading={shareMode === "join" && !joinToken && mintJoin.isPending}
            />
            <DialogFooter>
              <Button onClick={() => setShareOpen(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Edit01Icon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-muted text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={18} />
      {label}
    </button>
  );
}

function ShareLinkBody({
  shareUrl,
  copied,
  onCopy,
  loading,
}: {
  shareUrl: string;
  copied: boolean;
  onCopy: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-0 sm:px-0">
      <Input
        readOnly
        value={loading ? "Creating join link…" : shareUrl}
        className="font-mono text-xs md:text-sm"
        onFocus={(e) => e.target.select()}
      />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={copied ? "Copied" : "Copy link"}
        onClick={onCopy}
        className="shrink-0"
        disabled={loading}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
      </Button>
    </div>
  );
}
