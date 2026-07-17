"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  BotIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CloudUploadIcon,
  GitBranchIcon,
  Image01Icon,
  Search01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { signIn, useSession } from "next-auth/react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

import ImportRepoDialog from "./import-repo";

const ATTACH_OPTIONS = [
  { id: "import", label: "Import repo", icon: GitBranchIcon },
  { id: "media", label: "Add media", icon: Image01Icon },
  { id: "research", label: "Research in depth", icon: Search01Icon },
] as const;

type AttachOptionId = (typeof ATTACH_OPTIONS)[number]["id"];

type Attachment =
  | { key: string; kind: "repo"; shortName: string; fullName: string }
  | { key: string; kind: "media"; label: string }
  | { key: string; kind: "research"; label: string };

import {
  AI_MODELS,
  EFFORT_LEVELS,
  type EffortId,
  type ModelId,
} from "@/lib/ai-models";

const MODELS = AI_MODELS;

const PROMPT_SUGGESTIONS = [
  "Build a Next.js landing page with a waitlist",
  "Clone my repo and fix the failing tests",
  "Scaffold a Stripe checkout for a SaaS plan",
] as const;

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
  onImport: (repoFullName?: string) => void;
  onCreateFromPrompt?: (
    prompt: string,
    opts?: { model: ModelId; effort: EffortId },
  ) => void;
  model?: ModelId;
  effort?: EffortId;
  onModelChange?: (model: ModelId) => void;
  onEffortChange?: (effort: EffortId) => void;
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
  model: modelProp,
  effort: effortProp,
  onModelChange,
  onEffortChange,
}: ProjectsProps) {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [draft, setDraft] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [attachRepoOpen, setAttachRepoOpen] = React.useState(false);
  const [modelLocal, setModelLocal] = React.useState<ModelId>("auto");
  const [effortLocal, setEffortLocal] = React.useState<EffortId>("high");
  const model = modelProp ?? modelLocal;
  const effort = effortProp ?? effortLocal;
  const setModel = onModelChange ?? setModelLocal;
  const setEffort = onEffortChange ?? setEffortLocal;
  const active =
    LANDING_FEATURES.find((f) => f.id === featureId) ?? LANDING_FEATURES[0];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const prompt = draft.trim();
    const repo = attachments.find((a) => a.kind === "repo");
    if (!prompt) {
      onImport(repo?.fullName);
      return;
    }
    if (onCreateFromPrompt) {
      onCreateFromPrompt(prompt, { model, effort });
      setDraft("");
      setAttachments([]);
      return;
    }
    onImport(repo?.fullName);
    setDraft("");
    setAttachments([]);
  }

  function attachRepo(info: { owner: string; repo: string }) {
    const fullName = `${info.owner}/${info.repo}`;
    setAttachments((prev) => [
      ...prev.filter((a) => a.kind !== "repo"),
      {
        key: "repo",
        kind: "repo",
        shortName: info.repo,
        fullName,
      },
    ]);
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

        <div className="flex w-full flex-col gap-2">
          <form
            onSubmit={submit}
            className={cn(
              "bg-background flex w-full flex-col rounded-3xl border shadow-sm",
              "focus-within:border-ring focus-within:ring-ring/30 focus-within:ring-3",
            )}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="What are we building today?"
              rows={2}
              className="placeholder:text-muted-foreground min-h-16 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none md:text-sm"
              aria-label="What are we building today?"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <AttachMenu
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                  onImportRepo={() => setAttachRepoOpen(true)}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ModelPicker
                  model={model}
                  effort={effort}
                  onModelChange={setModel}
                  onEffortChange={setEffort}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 shrink-0 rounded-full bg-slate-300 text-black hover:bg-slate-300/80"
                  aria-label="Create project"
                  disabled={creating}
                >
                  <HugeiconsIcon
                    icon={SentIcon}
                    size={14}
                    className="text-black"
                  />
                </Button>
              </div>
            </div>
          </form>

          <ImportRepoDialog
            open={attachRepoOpen}
            onOpenChange={setAttachRepoOpen}
            mode="attach"
            onAttach={attachRepo}
          />

          {creating ? (
            <p className="text-muted-foreground text-sm">Spawning workspace…</p>
          ) : (
            <ul className="divide-border flex w-full flex-col divide-y">
              {PROMPT_SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground w-full py-2 text-left text-sm transition-colors"
                    onClick={() => setDraft(suggestion)}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachMenu({
  attachments,
  onAttachmentsChange,
  onImportRepo,
}: {
  attachments: Attachment[];
  onAttachmentsChange: (next: Attachment[]) => void;
  onImportRepo: () => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const hasAttachments = attachments.length > 0;

  function handleSelect(id: AttachOptionId) {
    setOpen(false);
    if (id === "import") {
      onImportRepo();
      return;
    }
    onAttachmentsChange(
      attachments.some((a) => a.kind === id)
        ? attachments.filter((a) => a.kind !== id)
        : [
            ...attachments,
            {
              key: id,
              kind: id,
              label: id === "media" ? "Media" : "Research",
            },
          ],
    );
  }

  function removeAttachment(key: string) {
    onAttachmentsChange(attachments.filter((a) => a.key !== key));
  }

  const addButtonClass = cn(
    "size-8 shrink-0 rounded-full transition-colors",
    hasAttachments
      ? "bg-muted text-foreground hover:bg-muted/80"
      : "text-muted-foreground",
  );

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {isMobile ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={addButtonClass}
            aria-label="Add"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <HugeiconsIcon icon={Add01Icon} size={18} />
          </Button>
          <Drawer
            open={open}
            onOpenChange={setOpen}
            swipeDirection="down"
            showSwipeHandle
          >
            <DrawerContent className="md:hidden">
              <DrawerHeader className="text-left">
                <DrawerTitle>Add</DrawerTitle>
                <DrawerDescription className="sr-only">
                  Import a repo, add media, or research in depth
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-1 px-3 pb-6">
                {ATTACH_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="hover:bg-muted/60 flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium"
                    onClick={() => handleSelect(option.id)}
                  >
                    <HugeiconsIcon icon={option.icon} size={18} />
                    {option.label}
                  </button>
                ))}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), addButtonClass)}
            aria-label="Add"
          >
            <HugeiconsIcon icon={Add01Icon} size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {ATTACH_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onClick={() => handleSelect(option.id)}
              >
                <HugeiconsIcon icon={option.icon} size={16} />
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasAttachments ? (
        <div className="scrollbar-none flex min-w-0 max-w-[min(100%,14rem)] items-center gap-1.5 overflow-x-auto sm:max-w-[18rem]">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.key}
              attachment={attachment}
              onRemove={() => removeAttachment(attachment.key)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const label =
    attachment.kind === "repo" ? attachment.shortName : attachment.label;
  const Icon =
    attachment.kind === "repo"
      ? GitBranchIcon
      : attachment.kind === "media"
        ? Image01Icon
        : Search01Icon;

  return (
    <span className="bg-muted text-foreground inline-flex h-7 shrink-0 items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs font-medium">
      <HugeiconsIcon icon={Icon} size={12} className="text-muted-foreground" />
      <span className="max-w-24 truncate">{label}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-full"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} />
      </button>
    </span>
  );
}

function EffortSlider({
  value,
  onChange,
}: {
  value: EffortId;
  onChange: (next: EffortId) => void;
}) {
  const index = Math.max(
    0,
    EFFORT_LEVELS.findIndex((level) => level.id === value),
  );

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          Effort
        </span>
        <span className="text-xs font-medium capitalize">{value}</span>
      </div>
      <Slider
        aria-label="Effort"
        min={0}
        max={EFFORT_LEVELS.length - 1}
        step={1}
        value={[index]}
        onValueChange={(next) => {
          const i = Array.isArray(next) ? (next[0] ?? 0) : next;
          const level = EFFORT_LEVELS[i];
          if (level) onChange(level.id);
        }}
        className="w-full"
      />
      <div className="text-muted-foreground flex justify-between px-0.5 text-[10px] font-medium capitalize">
        {EFFORT_LEVELS.map((level) => (
          <span key={level.id}>{level.id}</span>
        ))}
      </div>
    </div>
  );
}

function ModelList({
  model,
  onModelChange,
  className,
}: {
  model: ModelId;
  onModelChange: (next: ModelId) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {MODELS.map((item) => {
        const selected = item.id === model;
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
              selected ? "bg-muted" : "hover:bg-muted/60",
            )}
            onClick={() => onModelChange(item.id)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-muted-foreground truncate text-[11px]">
                {item.description}
              </span>
            </span>
            {selected ? (
              <HugeiconsIcon icon={Tick02Icon} size={16} className="shrink-0" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ModelPicker({
  model,
  effort,
  onModelChange,
  onEffortChange,
}: {
  model: ModelId;
  effort: EffortId;
  onModelChange: (next: ModelId) => void;
  onEffortChange: (next: EffortId) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const label = MODELS.find((m) => m.id === model)?.label ?? "Auto";

  function selectModel(next: ModelId) {
    onModelChange(next);
    if (!isMobile) setOpen(false);
  }

  const triggerLabel = (
    <>
      <span className="text-foreground font-medium">{label}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground capitalize">{effort}</span>
    </>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 rounded-full px-2.5 text-sm transition-colors"
          aria-label="Select AI model"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className="text-muted-foreground"
          />
        </button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          swipeDirection="down"
          showSwipeHandle
        >
          <DrawerContent className="md:hidden">
            <DrawerHeader className="text-left">
              <DrawerTitle>Model</DrawerTitle>
              <DrawerDescription className="sr-only">
                Choose effort and model
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-1 pb-6">
              <EffortSlider value={effort} onChange={onEffortChange} />
              <ModelList
                model={model}
                onModelChange={(next) => {
                  selectModel(next);
                  setOpen(false);
                }}
                className="px-1"
              />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 rounded-full px-2.5 text-sm transition-colors outline-none"
        aria-label="Select AI model"
      >
        {triggerLabel}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 p-1.5">
        <div
          onPointerDown={(e) => e.preventDefault()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <EffortSlider value={effort} onChange={onEffortChange} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={model}
          onValueChange={(value) => selectModel(value as ModelId)}
        >
          {MODELS.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.id}>
              <span className="flex flex-col gap-0.5">
                <span>{item.label}</span>
                <span className="text-muted-foreground text-[11px] font-normal">
                  {item.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
