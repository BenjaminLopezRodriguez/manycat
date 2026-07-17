"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowUpRight01Icon,
  BotIcon,
  BubbleChatIcon,
  CloudUploadIcon,
  GitBranchIcon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { signIn, useSession } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const LANDING_FEATURES = [
  {
    id: "chat",
    label: "Chat",
    blurb: "Ask for changes in plain English",
    hero: "Talk to your repo",
    detail:
      "Describe the fix. Agents read the codebase and propose concrete edits.",
    icon: BubbleChatIcon,
  },
  {
    id: "diffs",
    label: "Diffs",
    blurb: "Review every change before it lands",
    hero: "See the patch",
    detail: "Side-by-side diffs you approve — or send back with notes.",
    icon: GitBranchIcon,
  },
  {
    id: "deploy",
    label: "Deploy",
    blurb: "Preview from the same thread",
    hero: "Ship from chat",
    detail: "Kick off runs and open previews without leaving the conversation.",
    icon: CloudUploadIcon,
  },
  {
    id: "agents",
    label: "Agents",
    blurb: "Many specialists, one workspace",
    hero: "Many cats, one job",
    detail: "Spin up agents per workflow. Live status stays pinned in the shell.",
    icon: BotIcon,
  },
] as const;

export type LandingFeatureId = (typeof LANDING_FEATURES)[number]["id"];

type ProjectsProps = {
  onImport: () => void;
  onCreateFromPrompt?: (prompt: string) => void;
  creating?: boolean;
  featureId?: LandingFeatureId;
  onFeatureChange?: (id: LandingFeatureId) => void;
};

export default function Projects({
  onImport,
  onCreateFromPrompt,
  creating = false,
  featureId = "chat",
  onFeatureChange,
}: ProjectsProps) {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [draft, setDraft] = React.useState("");
  const active =
    LANDING_FEATURES.find((f) => f.id === featureId) ?? LANDING_FEATURES[0];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const prompt = draft.trim();
    if (!prompt) {
      onImport();
      return;
    }
    if (onCreateFromPrompt) {
      onCreateFromPrompt(prompt);
      setDraft("");
      return;
    }
    onImport();
    setDraft("");
  }

  if (!signedIn) {
    return (
      <div className="bg-background flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-8 py-10 md:px-10">
          <header className="flex max-w-xl flex-col gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">
              manycat
            </h1>
            <p className="text-lg font-medium tracking-tight md:text-xl">
              {active.hero}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed md:text-base">
              {active.detail}
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            {LANDING_FEATURES.map((feature) => {
              const selected = feature.id === active.id;
              return (
                <button
                  key={feature.id}
                  type="button"
                  onClick={() => onFeatureChange?.(feature.id)}
                  className={cn(
                    "hover:bg-muted/50 flex flex-col gap-2 rounded-2xl border px-4 py-3.5 text-left transition-colors",
                    selected && "bg-muted/60 border-foreground/15",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={feature.icon} size={16} />
                    <span className="text-sm font-medium">{feature.label}</span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {feature.blurb}
                  </p>
                  <ImpressionSketch featureId={feature.id} />
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-start gap-2">
            <Button
              size="lg"
              className="gap-2"
              onClick={() => void signIn("google", { callbackUrl: "/" })}
            >
              Continue with Google
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="gap-2"
              onClick={() => void signIn("github", { callbackUrl: "/" })}
            >
              Continue with GitHub
            </Button>
            <p className="text-muted-foreground text-xs">
              Google gets you in fast. Connect GitHub later to import private
              repos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-8 py-8 md:px-10">
        <header className="flex max-w-xl flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Ready when you are.
          </h1>
        </header>

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
            className="size-9 shrink-0 rounded-full bg-slate-300 text-black hover:bg-slate-300/80"
            aria-label="Create project"
            disabled={creating}
          >
            <HugeiconsIcon icon={SentIcon} size={16} className="text-black" />
          </Button>
        </form>

        <p className="text-muted-foreground max-w-md text-center text-sm">
          {creating
            ? "Spawning workspace…"
            : "Describe what to build — or tap + to import from GitHub."}
        </p>
      </div>
    </div>
  );
}

/** Tiny static sketches — light product impression, not real UI. */
function ImpressionSketch({ featureId }: { featureId: LandingFeatureId }) {
  if (featureId === "chat") {
    return (
      <div className="bg-background/80 mt-1 flex flex-col gap-1.5 rounded-xl p-2.5 font-mono text-[10px] leading-snug">
        <div className="text-muted-foreground">you · fix tax on checkout</div>
        <div className="bg-muted/80 w-[92%] rounded-lg px-2 py-1.5">
          Reading CartTotal.tsx…
        </div>
      </div>
    );
  }
  if (featureId === "diffs") {
    return (
      <div className="bg-background/80 mt-1 rounded-xl p-2.5 font-mono text-[10px] leading-snug">
        <div className="text-foreground">+ include taxRate in total</div>
        <div className="text-muted-foreground">− return sum(items)</div>
      </div>
    );
  }
  if (featureId === "deploy") {
    return (
      <div className="bg-background/80 mt-1 flex items-center gap-2 rounded-xl p-2.5 text-[10px]">
        <span className="bg-foreground/10 text-foreground rounded-full px-1.5 py-0.5 font-medium">
          preview
        </span>
        <span className="text-muted-foreground truncate font-mono">
          shop-web.vercel.app
        </span>
      </div>
    );
  }
  return (
    <div className="bg-background/80 mt-1 flex gap-1.5 rounded-xl p-2.5">
      {["CK", "LP", "AU"].map((id) => (
        <span
          key={id}
          className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-[9px] font-semibold"
        >
          {id}
        </span>
      ))}
      <span className="text-muted-foreground self-center text-[10px]">
        3 working
      </span>
    </div>
  );
}
