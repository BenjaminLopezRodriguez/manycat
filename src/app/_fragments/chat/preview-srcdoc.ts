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
  <!-- Approximate preview only; iframe is sandboxed. Tailwind CDN for utility classes. -->
  <script src="https://cdn.tailwindcss.com" crossorigin="anonymous"></script>
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
  <div data-preview-note>Preview · approximate (no live sandbox)</div>
</body>
</html>`;
}

function extractTitle(layoutSrc: string): string | null {
  const m = /title:\s*["'`]([^"'`]+)["'`]/.exec(layoutSrc);
  return m?.[1] ?? null;
}

/**
 * Extract the JSX returned by a page component and soften it to static HTML.
 * Must drop hooks / handlers — otherwise they render as text nodes in the body.
 */
function jsxToApproxHtml(src: string): string {
  if (!src.trim()) return "";

  const jsx = extractReturnedJsx(src);
  if (!jsx) return "";

  let s = jsx
    .replace(/className=/g, "class=")
    .replace(/htmlFor=/g, "for=")
    // Drop event handlers and refs entirely.
    .replace(/\s+on[A-Z][a-zA-Z]*=\{[\s\S]*?\}/g, "")
    .replace(/\s+ref=\{[\s\S]*?\}/g, "")
    // String-literal children / attrs in braces
    .replace(/\{`([^`]*)`\}/g, "$1")
    .replace(/\{"([^"]*)"\}/g, "$1")
    .replace(/\{'([^']*)'\}/g, "$1")
    // style={{ ... }} → drop (Tailwind classes carry look)
    .replace(/\s+style=\{\{[\s\S]*?\}\}/g, "")
    // Remaining JS expressions in braces → empty (keep structure)
    .replace(/\{[^}]*\}/g, "")
    .replace(/\/>/g, ">")
    .replace(/<>/g, "")
    .replace(/<\/>/g, "")
    // JSX comments
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  s = s.trim();
  // Reject if we still look like TypeScript (failed extraction).
  if (/^\s*(const|let|var|function|import|export)\b/.test(s)) return "";
  return s;
}

/** Pull the outermost JSX from `return (...)` / `return <...>` in the default export. */
function extractReturnedJsx(src: string): string {
  // Prefer the last `return (` — usual page pattern after hooks.
  const parenReturn = lastIndexOfRegex(src, /\breturn\s*\(/g);
  if (parenReturn >= 0) {
    const open = src.indexOf("(", parenReturn);
    const inner = sliceBalanced(src, open, "(", ")");
    if (inner !== null) {
      const trimmed = inner.trim();
      if (trimmed.startsWith("<") || trimmed.startsWith("(")) {
        return trimmed.replace(/^\(/, "").replace(/\)$/, "").trim();
      }
    }
  }

  // `return <div>...</div>`
  const bare = /\breturn\s*(<[\s\S]*)$/m.exec(src);
  if (bare?.[1]) {
    const start = src.indexOf(bare[1]);
    const end = findJsxEnd(src, start);
    if (end > start) return src.slice(start, end).trim();
  }

  // Fallback: largest top-level JSX-looking block in the file.
  const firstTag = src.search(/<(?:div|main|section|form|header|body|html)\b/);
  if (firstTag >= 0) {
    const end = findJsxEnd(src, firstTag);
    if (end > firstTag) return src.slice(firstTag, end).trim();
  }

  return "";
}

function lastIndexOfRegex(src: string, re: RegExp): number {
  let last = -1;
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = r.exec(src)) !== null) last = m.index;
  return last;
}

function sliceBalanced(
  src: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): string | null {
  if (openIdx < 0 || src[openIdx] !== openCh) return null;
  let depth = 0;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** End index after a JSX tree starting at `start` (`<tag...>`). */
function findJsxEnd(src: string, start: number): number {
  if (src[start] !== "<") return start;
  let i = start;
  let depth = 0;
  while (i < src.length) {
    if (src.startsWith("{/*", i)) {
      const end = src.indexOf("*/}", i + 3);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[i] === "{") {
      const inner = sliceBalanced(src, i, "{", "}");
      if (inner === null) break;
      i += inner.length + 2;
      continue;
    }
    if (src[i] === "<") {
      if (src.startsWith("</", i)) {
        const close = src.indexOf(">", i);
        if (close < 0) break;
        depth--;
        i = close + 1;
        if (depth <= 0) return i;
        continue;
      }
      // Opening or self-closing
      const close = src.indexOf(">", i);
      if (close < 0) break;
      const selfClosing = src[close - 1] === "/";
      const isComment = src.startsWith("<!--", i);
      if (isComment) {
        const end = src.indexOf("-->", i + 4);
        i = end < 0 ? src.length : end + 3;
        continue;
      }
      if (!selfClosing) depth++;
      i = close + 1;
      if (selfClosing && depth === 0 && i > start) return i;
      continue;
    }
    i++;
  }
  return i;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
