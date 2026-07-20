"""compose_env: synthesize a Dockerfile-based deployable environment.

Opt-in / fallback path for harder stacks where the greenfield Nixpacks default
(src/server/content/scaffold-next.ts) is not enough. Emits/updates three
container artifacts in the workspace: Dockerfile, .dockerignore, railway.toml.

Templates are plain strings (no template engine, stdlib only). Parity with the
scaffold scripts: build = `npm run build` (next build), start = next start on
$PORT, Node 22. Secrets are NEVER baked — only PORT + placeholder comments.
"""

from __future__ import annotations

# --- Template builders (Next-on-Node-22, scaffold parity) ---

_NEXT_DOCKERFILE = """\
# syntax=docker/dockerfile:1
# Deployable container for a Next.js (App Router) app on Node 22.
# Parity with the Manycat scaffold scripts: build = `npm run build` (next build),
# start = next start bound to $PORT. Railway injects PORT at runtime.
# NEVER bake secrets here — the app reads DATABASE_URL etc. from runtime env.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Railway overrides PORT at runtime; the default keeps `docker run` working locally.
ENV PORT=3000
COPY --from=build /app ./
EXPOSE $PORT
CMD ["sh", "-c", "next start -H 0.0.0.0 -p $PORT"]
"""

_DOCKERIGNORE = """\
.git
node_modules
.next
npm-debug.log*
.env
.env.*
"""

_RAILWAY_TOML_DOCKERFILE = """\
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "npm run start"
restartPolicyType = "ON_FAILURE"
"""


def next_dockerfile() -> str:
    """Node 22 Dockerfile: npm install && npm run build, next start on $PORT."""
    return _NEXT_DOCKERFILE


def dockerignore() -> str:
    """.dockerignore excluding .git, node_modules, .next (and .env secrets)."""
    return _DOCKERIGNORE


def railway_toml_dockerfile() -> str:
    """railway.toml with builder = "DOCKERFILE" + npm run start."""
    return _RAILWAY_TOML_DOCKERFILE


# --- Prompt section (mirrors DEPLOY_DEBUG in prompts/sections.py) ---

COMPOSE_ENV = """\
# Compose env / containerize (mandatory when synthesizing a Docker deploy env)

You are building a Dockerfile-based deployable environment. Emit/patch three
artifacts at the workspace root: Dockerfile, .dockerignore, railway.toml.

1. Detect the stack first (read package.json / lockfile / framework config).
2. For Next-on-Node the baseline is Node 22, `npm install && npm run build`,
   start `next start` bound to $PORT (parity with the Manycat scaffold scripts).
3. Write the files:
   - Dockerfile: multi-stage Node 22, `npm run build`, EXPOSE $PORT, start on $PORT.
   - .dockerignore: exclude .git, node_modules, .next (and .env secrets).
   - railway.toml: `builder = "DOCKERFILE"` + start command.
4. Use edit_file (minimal SEARCH/REPLACE diff) when a file already exists; use
   write_file only for new files.
5. Verify via `build_probe` (or `docker build .` if the sandbox has Docker) —
   do NOT claim success without a green build.
6. NEVER bake secrets: no DATABASE_URL value, no RAILWAY_API_TOKEN, no auth
   secrets. Only PORT and placeholder comments for the app's own runtime vars."""


def build_compose_env_prompt(user_prompt: str, seeded_summary: str = "") -> str:
    """Compose the user prompt for compose_env job mode.

    Mirrors build_deploy_debug_prompt (server.py): mode banner + evidence +
    reference templates + the user goal.
    """
    summary_block = ""
    if seeded_summary:
        summary_block = f"Workspace summary:\n{seeded_summary.strip()[:8_000]}\n\n"
    return (
        "COMPOSE ENV MODE — synthesize a Dockerfile-based deployable environment.\n"
        "Emit/patch three artifacts at the workspace root: Dockerfile, "
        '.dockerignore, railway.toml (builder = "DOCKERFILE").\n'
        "Detect the stack first. For Next-on-Node the templates below are the "
        "baseline (Node 22, npm install && npm run build, next start on $PORT).\n"
        "Use edit_file for files that already exist (minimal diff); write_file "
        "only for new files. Verify with build_probe (or `docker build .` if the "
        "sandbox has Docker). NEVER bake secrets — no DATABASE_URL / token "
        "values, only PORT and placeholder comments.\n\n"
        f"{summary_block}"
        "Reference templates (adapt to the detected stack):\n"
        f"```dockerfile\n{next_dockerfile()}```\n\n"
        f"```\n# .dockerignore\n{dockerignore()}```\n\n"
        f"```toml\n{railway_toml_dockerfile()}```\n\n"
        f"User / system goal:\n{user_prompt}"
    )
