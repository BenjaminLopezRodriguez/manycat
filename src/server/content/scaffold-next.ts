import type { ContentFile } from "@/server/content/store";

/** Patched Next that clears Railway's CVE gate (needs ≥15.2.8). */
export const SCAFFOLD_NEXT_VERSION = "15.5.20";

/**
 * Next.js App Router scaffold ready for Railway (Nixpacks) deploy.
 */
export function scaffoldNextFromPrompt(prompt: string): ContentFile[] {
  const title = deriveTitle(prompt);
  const slug = slugifyName(title);

  return [
    {
      path: "package.json",
      contents: JSON.stringify(
        {
          name: slug || "manycat-app",
          private: true,
          scripts: {
            dev: "next dev -H 0.0.0.0 -p ${PORT:-3000}",
            build: "next build",
            start: "next start -H 0.0.0.0 -p ${PORT:-3000}",
          },
          dependencies: {
            next: SCAFFOLD_NEXT_VERSION,
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
          devDependencies: {
            "@types/node": "^20.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
    },
    {
      path: "railway.toml",
      contents: `[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build"

[deploy]
startCommand = "npm run start"
restartPolicyType = "ON_FAILURE"
`,
    },
    {
      path: "next.config.ts",
      contents: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
    },
    {
      path: "tsconfig.json",
      contents: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./*"] },
          },
          include: [
            "next-env.d.ts",
            "**/*.ts",
            "**/*.tsx",
            ".next/types/**/*.ts",
          ],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    },
    {
      path: "app/layout.tsx",
      contents: `import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: ${JSON.stringify(title)},
  description: ${JSON.stringify(prompt.trim().slice(0, 160))},
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      path: "app/page.tsx",
      contents: `export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>${escapeJsxText(title)}</h1>
      <p>Scaffolded by Manycat from your prompt.</p>
      <blockquote style={{ marginTop: "1.5rem", paddingLeft: "1rem", borderLeft: "3px solid #3d7eff" }}>
        ${escapeJsxText(prompt.trim())}
      </blockquote>
    </main>
  );
}
`,
    },
    {
      path: "README.md",
      contents: `# ${title}\n\nCreated by Manycat from prompt:\n\n> ${prompt}\n\nRun: \`pnpm install && pnpm dev\`\n`,
    },
  ];
}

/**
 * Bump vulnerable Next pins / fix Railway build commands before mirror.
 * Existing prompt apps still have next@15.2.3 and pnpm railway.toml on disk.
 */
export function hardenWorkspaceForRailway(files: ContentFile[]): ContentFile[] {
  return files.map((file) => {
    if (file.path === "package.json" || file.path.endsWith("/package.json")) {
      return hardenPackageJson(file);
    }
    if (file.path === "railway.toml" || file.path.endsWith("/railway.toml")) {
      return hardenRailwayToml(file);
    }
    return file;
  });
}

function hardenPackageJson(file: ContentFile): ContentFile {
  try {
    const pkg = JSON.parse(file.contents) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    let changed = false;
    for (const bag of [pkg.dependencies, pkg.devDependencies]) {
      if (!bag?.next) continue;
      if (isNextBelowPatched(bag.next)) {
        bag.next = SCAFFOLD_NEXT_VERSION;
        changed = true;
      }
    }
    if (!changed) return file;
    return { ...file, contents: JSON.stringify(pkg, null, 2) + "\n" };
  } catch {
    return file;
  }
}

function hardenRailwayToml(file: ContentFile): ContentFile {
  const contents = file.contents;
  const next = contents
    .replaceAll("pnpm install && pnpm build", "npm install && npm run build")
    .replaceAll('startCommand = "pnpm start"', 'startCommand = "npm run start"')
    .replaceAll("pnpm start", "npm run start");
  if (next === contents) return file;
  return { ...file, contents: next };
}

function isNextBelowPatched(spec: string): boolean {
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)/.exec(spec.trim());
  if (!m?.[1] || !m[2] || !m[3]) return true;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  // Railway blocks < 15.2.8 for the CVE set in GHSA-9qr9-h5gf-34mp.
  if (major !== 15) return major < 15;
  if (minor !== 2) return minor < 2;
  return patch < 8;
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 40)
    return cleaned.replace(/^./, (c) => c.toUpperCase());
  return cleaned.slice(0, 37).trimEnd() + "…";
}

function slugifyName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function escapeJsxText(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}
