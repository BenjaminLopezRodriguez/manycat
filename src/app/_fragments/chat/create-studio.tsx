"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DEFAULT_IMAGE_CANDIDATES,
  IMAGE_CANDIDATE_COUNTS,
  IMAGE_MODELS,
  type ImageCandidateCount,
  type ImageModelId,
} from "@/lib/ai-models";
import { isBudgetExceededError } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { ChatThreadHeader } from "./chat-thread-header";
import { WorkflowChatMenu } from "./workflow-chat-menu";

const CREATE_SUGGESTIONS = [
  "Product photo of a ceramic mug on linen, soft daylight",
  "App icon for a note-taking tool, flat vector, indigo accent",
  "Wide hero of a coastal road at golden hour, cinematic",
] as const;

export type CreateWorkImage = {
  id: string;
  src: string;
  s3Key?: string;
};

export type CreateRevision = {
  id: string;
  images: CreateWorkImage[];
};

export type CreateWork = {
  id: string;
  title: string;
  revisions: CreateRevision[];
};

type CreateStudioProps = {
  activeWork?: CreateWork | null;
  onWorkStart: (work: { id: string; title: string }) => void;
  onWorkImages: (
    workId: string,
    revisionId: string,
    images: CreateWorkImage[],
  ) => void;
  onRenameWork?: (name: string) => void;
  onDeleteWork?: () => void;
  /** When true, block generate until the user subscribes. */
  budgetExhausted?: boolean;
  onUpgradeNeeded?: () => void;
};

type Slot =
  | { key: string; status: "pending" }
  | { key: string; status: "done"; src: string }
  | { key: string; status: "error" };

type LocalRevision = {
  id: string;
  slots: Slot[];
};

type EditRef = { key: string; src: string };

export default function CreateStudio({
  activeWork,
  onWorkStart,
  onWorkImages,
  onRenameWork,
  onDeleteWork,
  budgetExhausted = false,
  onUpgradeNeeded,
}: CreateStudioProps) {
  const utils = api.useUtils();
  const runImage = api.workflow.runImage.useMutation();
  const [draft, setDraft] = React.useState("");
  const [imageModel, setImageModel] = React.useState<ImageModelId>("auto");
  const [candidates, setCandidates] = React.useState<ImageCandidateCount>(
    DEFAULT_IMAGE_CANDIDATES,
  );
  const [revisions, setRevisions] = React.useState<LocalRevision[]>([]);
  const [revIndex, setRevIndex] = React.useState(0);
  const [generating, setGenerating] = React.useState(false);
  const [editRef, setEditRef] = React.useState<EditRef | null>(null);
  const workIdRef = React.useRef<string | null>(null);
  const pagerRef = React.useRef<HTMLDivElement>(null);
  const scrollSyncLock = React.useRef(false);

  const studio = revisions.length > 0;

  function goToRevision(index: number) {
    if (generating) return;
    const next = Math.max(0, Math.min(revisions.length - 1, index));
    setRevIndex(next);
    setEditRef(null);
    const pager = pagerRef.current;
    const page = pager?.querySelector<HTMLElement>(`[data-rev-page="${next}"]`);
    if (pager && page) {
      scrollSyncLock.current = true;
      page.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        scrollSyncLock.current = false;
      }, 450);
    }
  }

  React.useEffect(() => {
    const pager = pagerRef.current;
    if (!pager || !studio) return;

    function onScroll() {
      if (!pager || scrollSyncLock.current) return;
      const pageHeight = pager.clientHeight;
      if (pageHeight <= 0) return;
      const index = Math.round(pager.scrollTop / pageHeight);
      setRevIndex((prev) => {
        const next = Math.max(0, Math.min(revisions.length - 1, index));
        if (next !== prev) setEditRef(null);
        return next;
      });
    }

    pager.addEventListener("scroll", onScroll, { passive: true });
    return () => pager.removeEventListener("scroll", onScroll);
  }, [studio, revisions.length]);

  // Keep pager on the active page after a new revision is appended.
  React.useEffect(() => {
    if (!studio) return;
    const pager = pagerRef.current;
    const page = pager?.querySelector<HTMLElement>(
      `[data-rev-page="${revIndex}"]`,
    );
    if (!pager || !page) return;
    const pageHeight = pager.clientHeight;
    if (pageHeight <= 0) return;
    const expected = revIndex * pageHeight;
    if (Math.abs(pager.scrollTop - expected) > pageHeight * 0.2) {
      scrollSyncLock.current = true;
      page.scrollIntoView({
        behavior: generating ? "auto" : "smooth",
        block: "start",
      });
      window.setTimeout(
        () => {
          scrollSyncLock.current = false;
        },
        generating ? 50 : 450,
      );
    }
  }, [revIndex, revisions.length, studio, generating]);

  React.useEffect(() => {
    if (!activeWork) {
      if (!generating) {
        workIdRef.current = null;
        setRevisions([]);
        setRevIndex(0);
        setEditRef(null);
        setDraft("");
      }
      return;
    }

    // Hydrate only when the open work changes — not after each generate.
    if (workIdRef.current === activeWork.id) return;

    const hadPrior = workIdRef.current != null;
    workIdRef.current = activeWork.id;

    if (hadPrior) {
      setEditRef(null);
      setDraft("");
    }

    if (activeWork.revisions.length > 0) {
      const next = activeWork.revisions.map((rev) => ({
        id: rev.id,
        slots: rev.images.map(
          (img): Slot => ({
            key: img.id,
            status: "done",
            src: img.src,
          }),
        ),
      }));
      setRevisions(next);
      setRevIndex(next.length - 1);
    } else if (hadPrior) {
      setRevisions([]);
      setRevIndex(0);
    }
  }, [activeWork, generating]);

  async function generate(prompt: string) {
    if (budgetExhausted) {
      onUpgradeNeeded?.();
      return;
    }

    const title = prompt.slice(0, 48);
    const workId = workIdRef.current ?? `create-${Date.now()}`;
    const isNew = !workIdRef.current;

    if (isNew) {
      workIdRef.current = workId;
      onWorkStart({ id: workId, title });
    }

    const revisionId = `rev-${Date.now()}`;
    const pending: Slot[] = Array.from({ length: candidates }, (_, i) => ({
      key: `${revisionId}-${i}`,
      status: "pending" as const,
    }));

    setGenerating(true);
    setDraft("");
    setEditRef(null);
    setRevisions((prev) => {
      const next = [...prev, { id: revisionId, slots: pending }];
      setRevIndex(next.length - 1);
      return next;
    });

    let hitBudget = false;
    const results = await Promise.all(
      pending.map(async (slot) => {
        try {
          const { image, s3Key } = await runImage.mutateAsync({
            prompt,
            chatId: workId,
            imageId: slot.key,
          });
          return {
            key: slot.key,
            status: "done" as const,
            src: image,
            s3Key,
          };
        } catch (err) {
          if (isBudgetExceededError(err)) hitBudget = true;
          return { key: slot.key, status: "error" as const };
        }
      }),
    );
    if (hitBudget) onUpgradeNeeded?.();
    void utils.project.budget.invalidate();

    setRevisions((prev) =>
      prev.map((rev) =>
        rev.id === revisionId
          ? {
              ...rev,
              slots: results.map((r) =>
                r.status === "done"
                  ? { key: r.key, status: "done" as const, src: r.src }
                  : { key: r.key, status: "error" as const },
              ),
            }
          : rev,
      ),
    );
    setGenerating(false);

    const done = results
      .filter(
        (
          r,
        ): r is {
          key: string;
          status: "done";
          src: string;
          s3Key?: string;
        } => r.status === "done",
      )
      .map((r) => ({ id: r.key, src: r.src, s3Key: r.s3Key }));
    if (done.length > 0) {
      onWorkImages(workId, revisionId, done);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (budgetExhausted) {
      onUpgradeNeeded?.();
      return;
    }
    const prompt = draft.trim();
    if (!prompt || generating) return;
    void generate(prompt);
  }

  function selectForEdit(slot: Extract<Slot, { status: "done" }>) {
    setEditRef((prev) =>
      prev?.key === slot.key ? null : { key: slot.key, src: slot.src },
    );
  }

  return (
    <div className="bg-background relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {studio && activeWork && onRenameWork && onDeleteWork ? (
        <ChatThreadHeader
          title={activeWork.title}
          actions={
            <WorkflowChatMenu
              workflowId={activeWork.id}
              name={activeWork.title}
              onRename={onRenameWork}
              onDelete={onDeleteWork}
            />
          }
        />
      ) : null}

      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-8 transition-[justify-content,gap,padding] duration-500 ease-out md:px-10",
          studio
            ? "justify-end gap-4 overflow-hidden pt-6 pb-6"
            : "items-center justify-center gap-6 py-8",
        )}
      >
        {studio ? (
          <div
            ref={pagerRef}
            className="min-h-0 w-full flex-1 snap-y snap-mandatory overflow-y-auto overscroll-y-contain"
          >
            {revisions.map((rev, i) => (
              <section
                key={rev.id}
                data-rev-page={i}
                aria-label={`Revision ${i + 1}`}
                className="box-border h-full w-full shrink-0 snap-start snap-always"
              >
                <RevisionGrid
                  slots={rev.slots}
                  editKey={editRef?.key ?? null}
                  onSelectEdit={selectForEdit}
                />
              </section>
            ))}
          </div>
        ) : (
          <header className="flex max-w-xl flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Ready when you are.
            </h1>
          </header>
        )}

        <div
          className={cn(
            "flex w-full flex-col gap-2",
            studio && "relative z-10 shrink-0",
          )}
        >
          <div className="flex min-h-0 items-stretch gap-2">
            <form
              onSubmit={submit}
              className={cn(
                "bg-card flex min-w-0 flex-1 flex-col rounded-3xl border shadow-sm",
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
                placeholder={
                  budgetExhausted
                    ? "Subscribe to keep generating…"
                    : editRef
                      ? "Describe edits to this image…"
                      : studio
                        ? "Describe a revision…"
                        : "Describe an image to generate…"
                }
                rows={2}
                className="placeholder:text-muted-foreground min-h-16 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none md:text-sm"
                aria-label="Image prompt"
                disabled={budgetExhausted}
                onFocus={() => {
                  if (budgetExhausted) onUpgradeNeeded?.();
                }}
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-1">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {editRef ? (
                    <EditImageChip
                      src={editRef.src}
                      onRemove={() => setEditRef(null)}
                    />
                  ) : null}
                  {budgetExhausted ? (
                    <button
                      type="button"
                      onClick={() => onUpgradeNeeded?.()}
                      className="text-destructive text-xs font-medium underline-offset-2 hover:underline"
                    >
                      Usage limit reached — upgrade
                    </button>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ImageModelPicker
                    model={imageModel}
                    onModelChange={setImageModel}
                  />
                  <CandidatesPicker
                    value={candidates}
                    onChange={setCandidates}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="size-8 shrink-0 rounded-full bg-slate-300 text-black hover:bg-slate-300/80"
                    aria-label="Generate image"
                    disabled={budgetExhausted || generating || !draft.trim()}
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

            {revisions.length > 0 ? (
              <RevisionRolodex
                count={revisions.length}
                active={revIndex}
                onChange={goToRevision}
              />
            ) : null}
          </div>

          {!studio ? (
            <ul className="divide-border flex w-full flex-col divide-y">
              {CREATE_SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground w-full py-2 text-left text-sm transition-colors disabled:opacity-50"
                    disabled={budgetExhausted}
                    onClick={() => {
                      if (budgetExhausted) {
                        onUpgradeNeeded?.();
                        return;
                      }
                      setDraft(suggestion);
                    }}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Discrete ticks — each `-` is a revision; stacked they read like `=`. */
function RevisionRolodex({
  count,
  active,
  onChange,
}: {
  count: number;
  active: number;
  onChange: (index: number) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const tick = root.querySelector<HTMLElement>(`[data-rev-tick="${active}"]`);
    tick?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div
      role="slider"
      aria-label="Revision"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={active + 1}
      aria-valuetext={`Revision ${active + 1} of ${count}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(Math.max(0, active - 1));
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(Math.min(count - 1, active + 1));
        }
      }}
      className={cn(
        "flex min-h-0 w-9 shrink-0 flex-col items-center self-stretch",
        "outline-none focus-visible:ring-ring/30 focus-visible:ring-3",
      )}
    >
      <div
        ref={listRef}
        className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overscroll-contain px-1.5 py-1"
      >
        {Array.from({ length: count }, (_, i) => {
          const selected = i === active;
          return (
            <button
              key={i}
              type="button"
              data-rev-tick={i}
              aria-label={`Revision ${i + 1}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onChange(i)}
              className={cn(
                "flex h-3 w-full shrink-0 items-center justify-center rounded-sm transition-colors",
                "hover:bg-muted/80",
              )}
            >
              <span
                className={cn(
                  "block h-0.5 rounded-full transition-all duration-200",
                  selected
                    ? "bg-foreground w-[14px]"
                    : "bg-muted-foreground/45 w-[10px]",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RevisionGrid({
  slots,
  editKey,
  onSelectEdit,
}: {
  slots: Slot[];
  editKey: string | null;
  onSelectEdit: (slot: Extract<Slot, { status: "done" }>) => void;
}) {
  const cols =
    slots.length <= 1 ? 1 : slots.length === 2 ? 2 : slots.length <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(slots.length / cols));

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center [container-type:size]">
      <div
        className="grid gap-2"
        style={{
          aspectRatio: `${cols} / ${rows}`,
          width: `min(100cqw, calc(100cqh * ${cols} / ${rows}))`,
          height: `min(100cqh, calc(100cqw * ${rows} / ${cols}))`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {slots.map((slot) => (
          <ImageSlot
            key={slot.key}
            slot={slot}
            selected={editKey === slot.key}
            onSelect={
              slot.status === "done" ? () => onSelectEdit(slot) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function EditImageChip({
  src,
  onRemove,
}: {
  src: string;
  onRemove: () => void;
}) {
  return (
    <span className="bg-muted text-foreground inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-1 pl-1 text-xs font-medium">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URLs from image harness */}
      <img src={src} alt="" className="size-6 rounded-full object-cover" />
      <span className="text-muted-foreground pr-0.5">Edit</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-full"
        aria-label="Remove edit reference"
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} />
      </button>
    </span>
  );
}

function ImageSlot({
  slot,
  selected,
  onSelect,
}: {
  slot: Slot;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const interactive = slot.status === "done" && onSelect;

  return (
    <div
      className={cn(
        "bg-muted relative min-h-0 min-w-0 overflow-hidden rounded-2xl",
        interactive && "cursor-pointer",
        selected &&
          "ring-foreground ring-2 ring-offset-2 ring-offset-background",
      )}
    >
      {slot.status === "pending" ? (
        <div className="surface-shimmer absolute inset-0" />
      ) : null}
      {slot.status === "done" ? (
        <button
          type="button"
          onClick={onSelect}
          className="absolute inset-0 size-full"
          aria-label={selected ? "Deselect image for edit" : "Edit this image"}
          aria-pressed={selected}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URLs from image harness */}
          <img
            src={slot.src}
            alt=""
            className="size-full object-cover opacity-0 transition-opacity duration-500 ease-out"
            onLoad={(e) => {
              e.currentTarget.classList.remove("opacity-0");
              e.currentTarget.classList.add("opacity-100");
            }}
          />
        </button>
      ) : null}
      {slot.status === "error" ? (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-xs">
          Couldn&apos;t generate
        </div>
      ) : null}
    </div>
  );
}

function ImageModelPicker({
  model,
  onModelChange,
}: {
  model: ImageModelId;
  onModelChange: (next: ImageModelId) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const label = IMAGE_MODELS.find((m) => m.id === model)?.label ?? "Auto";

  function selectModel(next: ImageModelId) {
    onModelChange(next);
    setOpen(false);
  }

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-1 rounded-full px-2.5 text-sm transition-colors"
          aria-label="Select image model"
          onClick={() => setOpen(true)}
        >
          <span className="text-foreground font-medium">{label}</span>
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
              <DrawerTitle>Image model</DrawerTitle>
              <DrawerDescription className="sr-only">
                Choose an image model
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-1 px-2 pb-6">
              {IMAGE_MODELS.map((item) => {
                const selected = item.id === model;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectModel(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground block text-[11px]">
                        {item.description}
                      </span>
                    </span>
                    {selected ? (
                      <HugeiconsIcon icon={Tick02Icon} size={16} />
                    ) : null}
                  </button>
                );
              })}
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
        aria-label="Select image model"
      >
        <span className="text-foreground font-medium">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 p-1.5">
        <DropdownMenuRadioGroup
          value={model}
          onValueChange={(value) => selectModel(value as ImageModelId)}
        >
          {IMAGE_MODELS.map((item) => (
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

function CandidatesPicker({
  value,
  onChange,
}: {
  value: ImageCandidateCount;
  onChange: (next: ImageCandidateCount) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex h-8 items-center rounded-full px-2 font-mono text-sm transition-colors"
          aria-label={`Candidates: ${value}`}
          onClick={() => setOpen(true)}
        >
          [{value}]
        </button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          swipeDirection="down"
          showSwipeHandle
        >
          <DrawerContent className="md:hidden">
            <DrawerHeader className="text-left">
              <DrawerTitle>Candidates</DrawerTitle>
              <DrawerDescription>
                How many images to generate (1–5)
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-wrap gap-2 px-4 pb-6">
              {IMAGE_CANDIDATE_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    onChange(n);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl font-mono text-sm transition-colors",
                    n === value
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  [{n}]
                </button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="text-muted-foreground hover:text-foreground flex h-8 items-center rounded-full px-2 font-mono text-sm transition-colors outline-none"
        aria-label={`Candidates: ${value}`}
      >
        [{value}]
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-28 p-1.5">
        <DropdownMenuRadioGroup
          value={String(value)}
          onValueChange={(v) => {
            const n = Number(v) as ImageCandidateCount;
            if (IMAGE_CANDIDATE_COUNTS.includes(n)) {
              onChange(n);
              setOpen(false);
            }
          }}
        >
          {IMAGE_CANDIDATE_COUNTS.map((n) => (
            <DropdownMenuRadioItem key={n} value={String(n)}>
              [{n}]
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
