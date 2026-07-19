import type { WorkspaceFile } from "./data";

/**
 * Best-effort HTML preview from workspace files (sleight of hand).
 * Not a full Next runtime — enough to show layout/copy while sandbox boots.
 * Assumes shared disposable DB tables when the app needs data.
 */
export function buildPreviewSrcdoc(files: WorkspaceFile[]): string {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\.\//, ""), f.contents]));

  const page =
    byPath.get("app/page.tsx") ??
    byPath.get("src/app/page.tsx") ??
    byPath.get("pages/index.tsx") ??
    "";
  const layout =
    byPath.get("app/layout.tsx") ??
    byPath.get("src/app/layout.tsx") ??
    "";
  const globals =
    byPath.get("app/globals.css") ??
    byPath.get("src/app/globals.css") ??
    byPath.get("styles/globals.css") ??
    "";

  const approx = jsxToApproxHtml(page);
  const bodyInner =
    approx.length > 0
      ? approx
      : "<p>No page.tsx yet — waiting for the agent.</p>";
  const title = extractTitle(layout) ?? "Preview";
  const css =
    globals.length > 0
      ? globals
      : "body{font-family:system-ui,sans-serif;margin:0;padding:1.5rem;}";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${css}
  /* preview chrome */
  body { min-height: 100vh; }
  [data-preview-note] {
    position: fixed; bottom: 8px; right: 8px; z-index: 9999;
    font: 11px/1.3 system-ui, sans-serif; opacity: 0.55;
    background: #111; color: #fff; padding: 4px 8px; border-radius: 6px;
  }
  </style>
</head>
<body>
  ${bodyInner}
  <div data-preview-note>Preview · shared disposable DB if needed</div>
</body>
</html>`;
}

function extractTitle(layoutSrc: string): string | null {
  const m = /title:\s*["'`]([^"'`]+)["'`]/.exec(layoutSrc);
  return m?.[1] ?? null;
}

/** Crude JSX/TSX → HTML: strips imports/exports and softens common JSX. */
function jsxToApproxHtml(src: string): string {
  if (!src.trim()) return "";

  let s = src
    .replace(/^[\s\S]*?export\s+default\s+function[\s\S]*?\{/, "")
    .replace(/^[\s\S]*?export\s+default\s*\(/, "")
    .replace(/^\s*return\s*\(/, "")
    .replace(/\)\s*;?\s*\}\s*$/, "");

  // Drop imports / types leftover
  s = s
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/className=/g, "class=")
    .replace(/htmlFor=/g, "for=")
    .replace(/\{`([^`]*)`\}/g, "$1")
    .replace(/\{"([^"]*)"\}/g, "$1")
    .replace(/\{'([^']*)'\}/g, "$1")
    // Remove simple JS expressions in braces
    .replace(/\{[^}]*\}/g, "")
    .replace(/\/>/g, ">")
    .replace(/<>/g, "")
    .replace(/<\/>/g, "");

  // Self-closing void-ish tags already handled; unwrap fragments
  s = s.trim();
  if (!s) return "";
  return s;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
