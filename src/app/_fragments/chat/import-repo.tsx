"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { dedupeId, slugify } from "@/lib/slug";
import { api } from "@/trpc/react";

const GITHUB_REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

// ponytail: duplicated from the server router (workflow.ts) rather than shared —
// that module pulls in server-only env/trpc, importing it client-side would break the build.
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

export default function ImportRepoDialog({
  open,
  onOpenChange,
  existingIds,
  onImportStart,
  onImportSuccess,
  onImportError,
}: ImportRepoDialogProps) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const importMutation = api.workflow.importRepo.useMutation();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRepoUrl(value);
    if (!parsed) {
      setError("Enter a public GitHub repo — owner/repo or https://github.com/owner/repo");
      return;
    }
    setError(null);

    const repoUrl = value.trim();
    const workflowId = dedupeId(slugify(`${parsed.owner}-${parsed.repo}`), existingIds);
    onImportStart({ workflowId, owner: parsed.owner, repo: parsed.repo });
    onOpenChange(false);
    setValue("");

    importMutation.mutate(
      { repoUrl, existingIds },
      {
        onSuccess: (data) => onImportSuccess(data),
        onError: (err) => onImportError(workflowId, err.message),
      },
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto w-full sm:max-w-sm">
        <DrawerHeader className="text-left">
          <DrawerTitle>Import from GitHub</DrawerTitle>
          <DrawerDescription>
            Public repos only — creates a workflow with a live sandbox.
          </DrawerDescription>
        </DrawerHeader>
        <form onSubmit={submit} className="flex flex-col gap-3 px-6 pb-6">
          <Input
            autoFocus
            placeholder="owner/repo or https://github.com/owner/repo"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <DrawerClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DrawerClose>
            <Button type="submit" disabled={!value.trim()}>
              Import
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
