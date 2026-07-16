"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type * as Monaco from "monaco-editor";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Folder01Icon } from "@hugeicons/core-free-icons";

import { buildMonacoTheme, MANYCAT_EDITOR_THEME } from "@/lib/code-theme";
import { cn } from "@/lib/utils";
import type { DiffMsg, WorkspaceFile } from "./data";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => <EditorSkeleton />,
  },
);

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.DiffEditor),
  {
    ssr: false,
    loading: () => <EditorSkeleton />,
  },
);

function EditorSkeleton() {
  return (
    <div className="bg-muted/40 text-muted-foreground flex h-full items-center justify-center text-sm">
      Loading editor…
    </div>
  );
}

const MANYCAT_THEME = MANYCAT_EDITOR_THEME;

function defineTheme(monaco: typeof Monaco) {
  buildMonacoTheme(monaco);
}

function languageFromPath(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

type WorkspaceProps = {
  files: WorkspaceFile[];
  activePath: string | null;
  onSelectFile: (path: string) => void;
  diff: DiffMsg | null;
  onClearDiff: () => void;
  className?: string;
};

export default function Workspace({
  files,
  activePath,
  onSelectFile,
  diff,
  onClearDiff,
  className,
}: WorkspaceProps) {
  const active = files.find((f) => f.path === activePath) ?? files[0] ?? null;

  const handleMount = React.useCallback(
    (_editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      defineTheme(monaco);
      monaco.editor.setTheme(MANYCAT_THEME);
    },
    [],
  );

  const handleDiffMount = React.useCallback(
    (_editor: Monaco.editor.IStandaloneDiffEditor, monaco: typeof Monaco) => {
      defineTheme(monaco);
      monaco.editor.setTheme(MANYCAT_THEME);
    },
    [],
  );

  return (
    <div
      className={cn(
        "bg-card flex min-h-0 min-w-0 flex-1 flex-col",
        className,
      )}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={14}
            className="text-muted-foreground shrink-0"
          />
          <span className="truncate">
            {diff ? `Diff · ${diff.path}` : (active?.path ?? "Workspace")}
          </span>
        </div>
        {diff ? (
          <button
            type="button"
            onClick={onClearDiff}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          >
            Close diff
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2 text-xs">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => {
                onClearDiff();
                onSelectFile(f.path);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                !diff && active?.path === f.path
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={File01Icon} size={12} className="shrink-0" />
              <span className="truncate">{f.path.split("/").pop()}</span>
              {f.edited ? (
                <span className="bg-primary ml-auto size-1.5 shrink-0 rounded-full" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {diff ? (
            <MonacoDiffEditor
              height="100%"
              language={languageFromPath(diff.path)}
              original={diff.before}
              modified={diff.after}
              theme={MANYCAT_THEME}
              onMount={handleDiffMount}
              options={{
                readOnly: true,
                renderSideBySide: false,
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          ) : active ? (
            <MonacoEditor
              height="100%"
              language={active.language ?? languageFromPath(active.path)}
              value={active.contents}
              theme={MANYCAT_THEME}
              onMount={handleMount}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 12 },
              }}
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              No files in this workspace
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
