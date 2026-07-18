"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Camera01Icon,
  GithubIcon,
  Link01Icon,
  MagicWand01Icon,
  Mail01Icon,
  Message01Icon,
  Notion01Icon,
  PaintBrush01Icon,
  Search01Icon,
  WorkflowSquare01Icon,
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
import { api } from "@/trpc/react";

type IntegrationStatus = "available" | "coming";

type Integration = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  icon: typeof GithubIcon;
  keywords?: string[];
};

type Panel = "grid" | "request";

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
    id: "canva",
    name: "Canva",
    description: "Design assets and templates for agents.",
    status: "coming",
    icon: PaintBrush01Icon,
    keywords: ["design", "graphics", "brand"],
  },
  {
    id: "vsco",
    name: "VSCO",
    description: "Share photo edits and albums.",
    status: "coming",
    icon: Camera01Icon,
    keywords: ["photo", "social"],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read and send mail from workflows.",
    status: "coming",
    icon: Mail01Icon,
    keywords: ["email", "inbox", "google"],
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Trigger automations when agents finish.",
    status: "coming",
    icon: WorkflowSquare01Icon,
    keywords: ["automation", "workflow", "zap"],
  },
  {
    id: "higgsfield",
    name: "Higgsfield",
    description: "Generate and edit images with AI.",
    status: "coming",
    icon: MagicWand01Icon,
    keywords: ["ai", "image", "video", "gen"],
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
    id: "notion",
    name: "Notion",
    description: "Read and write project docs.",
    status: "coming",
    icon: Notion01Icon,
    keywords: ["docs", "wiki"],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Pull designs into agent context.",
    status: "coming",
    icon: Link01Icon,
    keywords: ["design", "ui"],
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
  sessionEmail?: string | null;
};

export function IntegrationsSheet({
  open,
  onOpenChange,
  hasGitHub = false,
  sessionEmail = null,
}: IntegrationsSheetProps) {
  const [query, setQuery] = React.useState("");
  const [panel, setPanel] = React.useState<Panel>("grid");
  const [requestName, setRequestName] = React.useState("");
  const [requestNote, setRequestNote] = React.useState("");
  const [requestEmail, setRequestEmail] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formOk, setFormOk] = React.useState(false);

  const requestMutation = api.integration.request.useMutation();

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setPanel("grid");
      setRequestName("");
      setRequestNote("");
      setRequestEmail("");
      setFormError(null);
      setFormOk(false);
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = CATALOG.filter((item) => matchesQuery(item, q));

  function openRequest(name: string) {
    setRequestName(name);
    setRequestNote("");
    setRequestEmail(sessionEmail ?? "");
    setFormError(null);
    setFormOk(false);
    setPanel("request");
  }

  function backToGrid() {
    setPanel("grid");
    setFormError(null);
    setFormOk(false);
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(false);
    try {
      await requestMutation.mutateAsync({
        name: requestName.trim(),
        note: requestNote.trim() || undefined,
        contactEmail: requestEmail.trim() || undefined,
      });
      setFormOk(true);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Could not send request";
      setFormError(msg);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-lg"
        showCloseButton
      >
        <SheetHeader className="border-border/80 border-b px-5 py-5 pr-14">
          <SheetTitle className="font-heading text-lg tracking-tight">
            Integrations
          </SheetTitle>
          <SheetDescription>
            External accounts and tools your agents can use.
          </SheetDescription>
          {panel === "grid" ? (
            <label className="relative mt-3 block">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search GitHub, Canva, Gmail…"
                className="h-10 rounded-2xl pl-9"
                autoFocus
              />
            </label>
          ) : null}
        </SheetHeader>

        {panel === "grid" ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
              {filtered.length === 0 ? (
                <p className="text-muted-foreground px-2 py-8 text-center text-sm">
                  No matches. Request an integration below.
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {filtered.map((item) => {
                    const connected = item.id === "github" && hasGitHub;
                    return (
                      <li key={item.id}>
                        <div className="border-border/80 flex h-full flex-col gap-3 rounded-2xl border px-3 py-3">
                          <div className="flex items-start gap-3">
                            <span className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl">
                              <HugeiconsIcon icon={item.icon} size={20} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {item.name}
                              </p>
                              <p className="text-muted-foreground text-xs leading-snug">
                                {item.description}
                              </p>
                            </div>
                          </div>
                          <div className="mt-auto flex items-center justify-between gap-2">
                            {connected ? (
                              <span className="text-muted-foreground text-xs font-medium">
                                Connected
                              </span>
                            ) : item.status === "available" ? (
                              <>
                                <span className="text-muted-foreground text-xs">
                                  Available
                                </span>
                                <Button
                                  size="sm"
                                  className="rounded-2xl"
                                  onClick={() => {
                                    void signIn("github", {
                                      callbackUrl: "/",
                                    });
                                  }}
                                >
                                  Connect
                                </Button>
                              </>
                            ) : (
                              <>
                                <span className="text-muted-foreground text-xs">
                                  Coming soon
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-2xl"
                                  onClick={() => openRequest(item.name)}
                                >
                                  Request
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-border/80 border-t p-3">
              <Button
                className="w-full rounded-2xl"
                variant="outline"
                onClick={() => openRequest(query.trim())}
              >
                Request integration
              </Button>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
            <button
              type="button"
              onClick={backToGrid}
              className="text-muted-foreground hover:text-foreground mb-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium transition-colors"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              Back
            </button>

            <form onSubmit={submitRequest} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="integration-request-name"
                  className="text-sm font-medium"
                >
                  Integration name
                </label>
                <Input
                  id="integration-request-name"
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="e.g. Canva"
                  className="h-10 rounded-2xl"
                  autoFocus
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="integration-request-note"
                  className="text-sm font-medium"
                >
                  Note{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="integration-request-note"
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="How would you use it?"
                  rows={3}
                  className={cn(
                    "border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-2xl border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1",
                  )}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="integration-request-email"
                  className="text-sm font-medium"
                >
                  Contact email{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </label>
                <Input
                  id="integration-request-email"
                  type="email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10 rounded-2xl"
                />
              </div>

              {formError ? (
                <p className="text-destructive text-sm" role="alert">
                  {formError}
                </p>
              ) : null}
              {formOk ? (
                <p className="text-muted-foreground text-sm" role="status">
                  Request sent. We&apos;ll take a look.
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full rounded-2xl"
                disabled={
                  requestMutation.isPending || requestName.trim().length === 0
                }
              >
                {requestMutation.isPending ? "Sending…" : "Send request"}
              </Button>
            </form>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default IntegrationsSheet;
