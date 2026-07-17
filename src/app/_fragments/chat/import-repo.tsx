"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { dedupeId, slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const GITHUB_REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

function parseRepoUrl(raw: string): { owner: string; repo: string } | null {
  const trimmed = raw.trim();
  const url = SHORTHAND_RE.test(trimmed) ? `https://github.com/${trimmed}` : trimmed;
  if (!GITHUB_REPO_RE.test(url)) return null;
  const match = /github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?$/.exec(url);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

export type ImportRepoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingIds: string[];
  onImportStart: (info: { workflowId: string; owner: string; repo: string }) => void;
  onImportSuccess: (data: {
    workflowId: string;
    name: string;
    repo: string;
    status: "idle";
  }) => void;
  onImportError: (workflowId: string, message: string) => void;
};

function ImportBody({
  existingIds,
  onImportStart,
  onImportSuccess,
  onImportError,
  onOpenChange,
  Close,
}: {
  existingIds: string[];
  onImportStart: ImportRepoDialogProps["onImportStart"];
  onImportSuccess: ImportRepoDialogProps["onImportSuccess"];
  onImportError: ImportRepoDialogProps["onImportError"];
  onOpenChange: (open: boolean) => void;
  Close: React.ComponentType<{ children: React.ReactNode; className?: string }>;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [signingIn, setSigningIn] = React.useState(false);
  const importMutation = api.workflow.importRepo.useMutation();
  const { data: status, isLoading: statusLoading } =
    api.github.status.useQuery();
  const reposQuery = api.github.listRepos.useQuery(undefined, {
    enabled: Boolean(status?.signedIn),
  });

  async function handleSignIn() {
    if (!status?.configured) {
      setError(
        "Add AUTH_GITHUB_ID and AUTH_GITHUB_SECRET to .env (see .env.example).",
      );
      return;
    }
    setSigningIn(true);
    setError(null);
    await signIn("github", { callbackUrl: "/?import=1" });
  }

  function startImport(raw: string) {
    const parsed = parseRepoUrl(raw);
    if (!parsed) {
      setError("Pick a repo or enter owner/repo");
      return;
    }
    setError(null);

    const workflowId = dedupeId(
      slugify(`${parsed.owner}-${parsed.repo}`),
      existingIds,
    );
    onImportStart({ workflowId, owner: parsed.owner, repo: parsed.repo });
    onOpenChange(false);

    importMutation.mutate(
      { repoUrl: raw.trim(), existingIds },
      {
        onSuccess: (data) => onImportSuccess(data),
        onError: (err) => onImportError(workflowId, err.message),
      },
    );
  }

  function importSelected(e: React.FormEvent) {
    e.preventDefault();
    const raw = selected ?? manual.trim();
    if (!raw) {
      setError("Select a project to import");
      return;
    }
    startImport(raw);
  }

  if (statusLoading) {
    return (
      <p className="text-muted-foreground px-1 pb-2 text-sm">Checking GitHub…</p>
    );
  }

  if (!status?.signedIn) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          className="w-full gap-2"
          disabled={signingIn}
          onClick={() => void handleSignIn()}
        >
          <HugeiconsIcon icon={GitBranchIcon} size={16} />
          {signingIn ? "Redirecting…" : "Sign in with GitHub"}
        </Button>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {!status?.configured ? (
          <p className="text-muted-foreground text-xs">
            Create a GitHub OAuth App with callback{" "}
            <code className="font-mono">
              /api/auth/callback/github
            </code>{" "}
            and set{" "}
            <code className="font-mono">AUTH_GITHUB_ID</code> /{" "}
            <code className="font-mono">AUTH_GITHUB_SECRET</code>.
          </p>
        ) : null}
        <Close className="w-full">Cancel</Close>
      </div>
    );
  }

  const repos = reposQuery.data ?? [];

  return (
    <form
      onSubmit={importSelected}
      className="flex min-w-0 flex-col gap-3 overflow-hidden"
    >
      <p className="text-muted-foreground text-xs">
        Signed in{status.login ? ` as ${status.login}` : ""}.
      </p>

      {reposQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading repos…</p>
      ) : reposQuery.isError ? (
        <p className="text-destructive text-sm">{reposQuery.error.message}</p>
      ) : repos.length === 0 ? (
        <p className="text-muted-foreground text-sm">No repositories found.</p>
      ) : (
        <ul className="flex max-h-56 min-w-0 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          {repos.map((repo) => (
            <li key={repo.fullName} className="min-w-0">
              <button
                type="button"
                onClick={() => {
                  setSelected(repo.fullName);
                  setManual("");
                  setError(null);
                }}
                className={cn(
                  "hover:bg-muted/60 flex w-full min-w-0 flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                  selected === repo.fullName && "bg-muted",
                )}
              >
                <span className="block truncate text-sm font-medium">
                  {repo.fullName}
                  {repo.private ? (
                    <span className="text-muted-foreground ml-1 text-[10px]">
                      private
                    </span>
                  ) : null}
                </span>
                {repo.description ? (
                  <span className="text-muted-foreground block truncate text-xs">
                    {repo.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <label
          htmlFor="manual-repo"
          className="text-muted-foreground text-xs font-medium"
        >
          Or paste a public repo
        </label>
        <Input
          id="manual-repo"
          className="min-w-0"
          placeholder="owner/repo"
          value={manual}
          onChange={(e) => {
            setManual(e.target.value);
            setSelected(null);
            setError(null);
          }}
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Close>Cancel</Close>
        <Button type="submit" disabled={!selected && !manual.trim()}>
          Import
        </Button>
      </div>
    </form>
  );
}

export default function ImportRepoDialog({
  open,
  onOpenChange,
  existingIds,
  onImportStart,
  onImportSuccess,
  onImportError,
}: ImportRepoDialogProps) {
  const isMobile = useIsMobile();
  const { data: status } = api.github.status.useQuery(undefined, {
    enabled: open,
  });

  const title = status?.signedIn ? "Select a project" : "Import from project";
  const description = status?.signedIn
    ? "Choose a GitHub repo to import into Manycat."
    : "Sign in with GitHub to choose a repository.";

  const body = (
    <ImportBody
      existingIds={existingIds}
      onImportStart={onImportStart}
      onImportSuccess={onImportSuccess}
      onImportError={onImportError}
      onOpenChange={onOpenChange}
      Close={({ children, className }) =>
        isMobile ? (
          <DrawerClose
            render={<Button type="button" variant="ghost" className={className} />}
          >
            {children}
          </DrawerClose>
        ) : (
          <DialogClose
            render={<Button type="button" variant="ghost" className={className} />}
          >
            {children}
          </DialogClose>
        )
      }
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="mx-auto w-full sm:max-w-sm">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="px-6 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90vh,40rem)] overflow-hidden sm:max-w-md"
        showCloseButton
      >
        <DialogHeader className="min-w-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
