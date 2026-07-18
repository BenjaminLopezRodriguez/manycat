"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Camera01Icon,
  CloudIcon,
  DiscordIcon,
  GithubIcon,
  Link01Icon,
  Message01Icon,
  Notion01Icon,
  Plug01Icon,
  Search01Icon,
  SourceCodeIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type IntegrationStatus = "available" | "coming";

type Integration = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  icon: typeof GithubIcon;
  keywords?: string[];
};

const CATALOG: Integration[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repos, PRs, and ship from chat.",
    status: "available",
    icon: GithubIcon,
    keywords: ["git", "repo", "code"],
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deploy previews and production.",
    status: "coming",
    icon: CloudIcon,
    keywords: ["deploy", "hosting"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Notify channels when agents finish.",
    status: "coming",
    icon: Message01Icon,
    keywords: ["chat", "notify"],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Post agent updates to a server.",
    status: "coming",
    icon: DiscordIcon,
    keywords: ["chat", "community"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read and write project docs.",
    status: "coming",
    icon: Notion01Icon,
    keywords: ["docs", "wiki"],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Sync issues with agent work.",
    status: "coming",
    icon: SourceCodeIcon,
    keywords: ["issues", "tickets"],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Pull designs into agent context.",
    status: "coming",
    icon: Link01Icon,
    keywords: ["design", "ui"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "Post and manage short video.",
    status: "coming",
    icon: Video01Icon,
    keywords: ["social", "video"],
  },
  {
    id: "vsco",
    name: "VSCO",
    description: "Share photo edits and albums.",
    status: "coming",
    icon: Camera01Icon,
    keywords: ["photo", "social"],
  },
];

function matchesQuery(item: Integration, q: string) {
  if (!q) return true;
  const hay = [item.name, item.description, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export type IntegrationsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasGitHub?: boolean;
};

export function IntegrationsSheet({
  open,
  onOpenChange,
  hasGitHub = false,
}: IntegrationsSheetProps) {
  const [query, setQuery] = React.useState("");
  const [requested, setRequested] = React.useState<Set<string>>(
    () => new Set(),
  );

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = CATALOG.filter((item) => matchesQuery(item, q));
  const exactMatch = CATALOG.some((item) => item.name.toLowerCase() === q);
  const showCustomRequest = q.length > 0 && !exactMatch;

  function requestIntegration(id: string) {
    setRequested((prev) => new Set(prev).add(id));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        showCloseButton
      >
        <SheetHeader className="border-border/80 border-b px-5 py-5 pr-14">
          <SheetTitle className="font-heading text-lg tracking-tight">
            Integrations
          </SheetTitle>
          <SheetDescription>
            External accounts and tools your agents can use.
          </SheetDescription>
          <label className="relative mt-3 block">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GitHub, TikTok, VSCO…"
              className="h-10 rounded-2xl pl-9"
              autoFocus
            />
          </label>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          {filtered.length === 0 && !showCustomRequest ? (
            <p className="text-muted-foreground px-2 py-8 text-center text-sm">
              No matches. Try another name or request it below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((item) => {
                const connected = item.id === "github" && hasGitHub;
                const isRequested = requested.has(item.id);
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-3",
                        "hover:bg-muted/70 transition-colors",
                      )}
                    >
                      <span className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl">
                        <HugeiconsIcon icon={item.icon} size={20} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {item.name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {item.description}
                        </p>
                      </div>
                      {connected ? (
                        <span className="text-muted-foreground shrink-0 text-xs font-medium">
                          Connected
                        </span>
                      ) : item.status === "available" ? (
                        <Button
                          size="sm"
                          className="shrink-0 rounded-2xl"
                          onClick={() => {
                            void signIn("github", { callbackUrl: "/" });
                          }}
                        >
                          Connect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={isRequested ? "secondary" : "outline"}
                          className="shrink-0 rounded-2xl"
                          disabled={isRequested}
                          onClick={() => requestIntegration(item.id)}
                        >
                          {isRequested ? "Requested" : "Request"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {showCustomRequest ? (
            <div
              className={cn(
                "mt-2 flex items-center gap-3 rounded-2xl border border-dashed px-3 py-3",
                "border-border bg-muted/30",
              )}
            >
              <span className="bg-background text-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl border">
                <HugeiconsIcon icon={Plug01Icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  Request “{query.trim()}”
                </p>
                <p className="text-muted-foreground text-xs">
                  Not in the catalog yet — tell us you want it.
                </p>
              </div>
              <Button
                size="sm"
                variant={
                  requested.has(`custom:${q}`) ? "secondary" : "outline"
                }
                className="shrink-0 rounded-2xl"
                disabled={requested.has(`custom:${q}`)}
                onClick={() => requestIntegration(`custom:${q}`)}
              >
                {requested.has(`custom:${q}`) ? "Requested" : "Request"}
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default IntegrationsSheet;
