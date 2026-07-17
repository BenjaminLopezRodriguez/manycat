import { createHash, randomBytes } from "node:crypto";

import type { ContentFile } from "@/server/content/store";
import { scaffoldNextFromPrompt } from "@/server/content/scaffold-next";
import { slugify } from "@/lib/slug";

/** Deterministic content-addressed root for a file tree (virtual git seam). */
export function hashTree(files: ContentFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const h = createHash("sha256");
  for (const f of sorted) {
    h.update(f.path);
    h.update("\0");
    h.update(f.contents);
    h.update("\0");
  }
  return h.digest("hex");
}

export function changeId(): string {
  return randomBytes(12).toString("hex");
}

export function projectNameFromPrompt(prompt: string): string {
  const clipped = prompt.trim().slice(0, 48);
  const slug = slugify(clipped) || "app";
  return slug.slice(0, 40);
}

/**
 * Prompt create defaults to a Next.js Railway-ready scaffold.
 * Static calculator / generic shells remain available via scaffoldStaticFromPrompt.
 */
export function scaffoldFromPrompt(prompt: string): ContentFile[] {
  return scaffoldNextFromPrompt(prompt);
}

/**
 * Legacy static scaffolds (calculator / branded shell). Unused by create path.
 */
export function scaffoldStaticFromPrompt(prompt: string): ContentFile[] {
  const title = deriveTitle(prompt);
  const isCalc = /calculat|math|arithmetic|counter/i.test(prompt);

  if (isCalc) {
    return calculatorScaffold(title, prompt);
  }
  return genericAppScaffold(title, prompt);
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 40) return cleaned.replace(/^./, (c) => c.toUpperCase());
  return cleaned.slice(0, 37).trimEnd() + "…";
}

function calculatorScaffold(title: string, prompt: string): ContentFile[] {
  return [
    {
      path: "package.json",
      contents: JSON.stringify(
        {
          name: "manycat-calculator",
          private: true,
          scripts: { dev: "node server.js", start: "node server.js" },
        },
        null,
        2,
      ),
    },
    {
      path: "server.js",
      contents: STATIC_SERVER,
    },
    {
      path: "index.html",
      contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <h1>${escapeHtml(title)}</h1>
      <p class="prompt">Built from: “${escapeHtml(prompt)}”</p>
      <div class="calc">
        <output id="display" class="display">0</output>
        <div class="keys">
          ${["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "="]
            .map((k) => `<button type="button" data-key="${escapeHtml(k)}">${escapeHtml(k)}</button>`)
            .join("\n          ")}
        </div>
      </div>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`,
    },
    {
      path: "styles.css",
      contents: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background: radial-gradient(circle at top, #1c2433, #0b0f14 55%);
  color: #e8eef7;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}
.shell { width: min(22rem, 100%); }
h1 { font-size: 1.25rem; margin: 0 0 0.35rem; font-weight: 600; }
.prompt { margin: 0 0 1rem; color: #9aa7b8; font-size: 0.8rem; }
.calc {
  background: #121821;
  border: 1px solid #243041;
  border-radius: 1.25rem;
  padding: 0.85rem;
  box-shadow: 0 20px 50px rgb(0 0 0 / 35%);
}
.display {
  display: block;
  width: 100%;
  min-height: 3.25rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-radius: 0.85rem;
  background: #0a0e14;
  text-align: right;
  font: 600 1.5rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}
.keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.45rem;
}
button {
  border: 0;
  border-radius: 0.75rem;
  padding: 0.85rem 0;
  background: #1b2431;
  color: inherit;
  font: 600 1rem/1 inherit;
  cursor: pointer;
}
button:hover { background: #243041; }
button[data-key="="] { background: #3d7eff; }
button[data-key="="]:hover { background: #5b91ff; }
button[data-key="0"] { grid-column: span 2; }
`,
    },
    {
      path: "app.js",
      contents: `const display = document.getElementById("display");
let expr = "";

function render() {
  display.textContent = expr || "0";
}

function push(key) {
  if (key === "C") { expr = ""; return render(); }
  if (key === "⌫") { expr = expr.slice(0, -1); return render(); }
  if (key === "=") {
    try {
      const normalized = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
      if (!/^[0-9.+\\-*/%()\\s]+$/.test(normalized)) throw new Error("bad");
      // eslint-disable-next-line no-new-func
      const value = Function(\`"use strict"; return (\${normalized || 0})\`)();
      expr = String(value);
    } catch {
      expr = "Error";
    }
    return render();
  }
  if (expr === "Error") expr = "";
  expr += key;
  render();
}

document.querySelectorAll("[data-key]").forEach((btn) => {
  btn.addEventListener("click", () => push(btn.getAttribute("data-key")));
});
`,
    },
    {
      path: "README.md",
      contents: `# ${title}\n\nCreated by Manycat from prompt:\n\n> ${prompt}\n\nRun: \`pnpm dev\` (served by sandbox).\n`,
    },
  ];
}

function genericAppScaffold(title: string, prompt: string): ContentFile[] {
  return [
    {
      path: "package.json",
      contents: JSON.stringify(
        {
          name: "manycat-app",
          private: true,
          scripts: { dev: "node server.js", start: "node server.js" },
        },
        null,
        2,
      ),
    },
    { path: "server.js", contents: STATIC_SERVER },
    {
      path: "index.html",
      contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <p class="eyebrow">manycat virtual workspace</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">Scaffolded from your prompt. The agent can iterate from here.</p>
      <blockquote>${escapeHtml(prompt)}</blockquote>
    </main>
  </body>
</html>
`,
    },
    {
      path: "styles.css",
      contents: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background: linear-gradient(160deg, #102033, #0a0f14 60%);
  color: #e8eef7;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}
.shell { width: min(36rem, 100%); }
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.7rem;
  color: #7f92a8;
  margin: 0 0 0.75rem;
}
h1 { margin: 0 0 0.75rem; font-size: clamp(1.6rem, 4vw, 2.4rem); }
.lede { color: #a9b7c8; line-height: 1.5; }
blockquote {
  margin: 1.5rem 0 0;
  padding: 1rem 1.1rem;
  border-left: 3px solid #3d7eff;
  background: rgb(255 255 255 / 4%);
  border-radius: 0 0.75rem 0.75rem 0;
  color: #d5deea;
}
`,
    },
    {
      path: "README.md",
      contents: `# ${title}\n\nCreated by Manycat from prompt:\n\n> ${prompt}\n`,
    },
  ];
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STATIC_SERVER = `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 3000);
const root = process.cwd();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safe = path.normalize(urlPath).replace(/^(\\.\\.[/\\\\])+/, "");
  let filePath = path.join(root, safe === "/" ? "index.html" : safe);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log("listening on " + port);
});
`;
