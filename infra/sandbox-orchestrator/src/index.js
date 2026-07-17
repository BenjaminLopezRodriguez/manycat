import express from "express";
import Docker from "dockerode";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json());

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/workspaces";
const HOST_WORKSPACE_ROOT = process.env.HOST_WORKSPACE_ROOT ?? WORKSPACE_ROOT;
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "manycat-sandbox:latest";
const PORT_MIN = Number(process.env.SANDBOX_PORT_MIN ?? 4000);
const PORT_MAX = Number(process.env.SANDBOX_PORT_MAX ?? 4999);
const PREVIEW_HOST = process.env.PREVIEW_HOST ?? "localhost";

/**
 * @typedef {{ containerId: string, hostPort: number, accountId?: string, mode?: "container" }} ContainerSandbox
 * @typedef {{ containerId?: undefined, hostPort?: undefined, accountId?: string, mode: "workspace-only" }} WorkspaceOnlySandbox
 * @type {Map<string, ContainerSandbox | WorkspaceOnlySandbox>}
 */
const sandboxes = new Map();

async function dockerAvailable() {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/** @type {Set<number>} */
const usedPorts = new Set();

function allocatePort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error("No sandbox ports available");
}

function releasePort(port) {
  usedPorts.delete(port);
}

function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function workspacePath(workflowId) {
  const dir = path.join(WORKSPACE_ROOT, safeId(workflowId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const GITHUB_REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
const SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

/** Accepts `https://github.com/owner/repo(.git)?` or `owner/repo` shorthand. Throws otherwise. */
function normalizeRepoUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("repoUrl must be a non-empty string");
  }
  const url = SHORTHAND_RE.test(raw) ? `https://github.com/${raw}` : raw;
  if (!GITHUB_REPO_RE.test(url)) {
    throw new Error("repoUrl must be a github.com https URL or owner/repo");
  }
  return url;
}

async function cloneRepo(repoUrl, dir) {
  // args array, never a shell string — repoUrl is hostile input
  await execFileAsync("git", ["clone", "--depth", "1", repoUrl, dir], {
    timeout: 120_000,
  });
}

async function writeSeedFiles(root, files) {
  for (const file of files) {
    const full = path.join(root, file.path);
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error("path escape blocked");
    }
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, file.contents, "utf8");
  }
}

async function initVirtualGit(root, prompt) {
  const gitDir = path.join(root, ".git");
  if (!fs.existsSync(gitDir)) {
    await execFileAsync("git", ["init"], { cwd: root, timeout: 15_000 });
    await execFileAsync("git", ["config", "user.email", "agent@manycat.local"], {
      cwd: root,
      timeout: 5_000,
    });
    await execFileAsync("git", ["config", "user.name", "Manycat"], {
      cwd: root,
      timeout: 5_000,
    });
  }
  await execFileAsync("git", ["add", "-A"], { cwd: root, timeout: 15_000 });
  const message = `manycat: ${String(prompt).slice(0, 72)}`;
  try {
    await execFileAsync("git", ["commit", "-m", message], {
      cwd: root,
      timeout: 15_000,
    });
  } catch {
    // nothing to commit is fine
  }
}

const SKIP_DIRS = new Set([".git", "node_modules"]);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 200_000;

function looksBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function walkWorkspace(root) {
  const results = [];
  async function walk(dir) {
    if (results.length >= MAX_FILES) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_FILES) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const buf = await fs.promises.readFile(full);
        if (looksBinary(buf)) continue;
        results.push({ path: path.relative(root, full), contents: buf.toString("utf8") });
      }
    }
  }
  await walk(root);
  return results;
}

function containerSpec(containerName, hostPort, hostWsPath) {
  return {
    name: containerName,
    Image: SANDBOX_IMAGE,
    Env: [`PORT=3000`],
    ExposedPorts: { "3000/tcp": {} },
    HostConfig: {
      Binds: [`${hostWsPath}:/workspace`],
      PortBindings: {
        "3000/tcp": [{ HostPort: String(hostPort) }],
      },
      AutoRemove: false,
    },
  };
}

async function createAndStart(spec) {
  const container = await docker.createContainer(spec);
  await container.start();
  return container;
}

/**
 * Looks up a container by name regardless of state. Running -> reused as-is.
 * Stopped/created/exited -> removed (workspace dir on disk is the durable
 * state, not the container) so the caller can create fresh. Returns null
 * when no reuse is possible (container absent or just removed).
 */
async function reconcileExisting(containerName) {
  const matches = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ name: [`^/${containerName}$`] }),
  });
  const found = matches[0];
  if (!found) return null;

  if (found.State === "running") {
    const portEntry = found.Ports.find((p) => p.PrivatePort === 3000 && p.PublicPort);
    return { containerId: found.Id, hostPort: portEntry?.PublicPort };
  }

  await docker.getContainer(found.Id).remove({ force: true });
  return null;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sandboxes: sandboxes.size });
});

app.post("/sandboxes", async (req, res) => {
  try {
    const { workflowId, repoUrl: rawRepoUrl, accountId: rawAccountId, files: rawFiles, prompt } =
      req.body;
    if (!workflowId || typeof workflowId !== "string") {
      res.status(400).json({ error: "workflowId required" });
      return;
    }

    // Optional Manycat account scope — never use for control-plane paths.
    const accountId =
      typeof rawAccountId === "string" && rawAccountId.length > 0
        ? safeId(rawAccountId)
        : undefined;

    /** @type {{ path: string, contents: string }[] | undefined} */
    let seedFiles;
    if (Array.isArray(rawFiles)) {
      seedFiles = [];
      for (const f of rawFiles) {
        if (
          !f ||
          typeof f.path !== "string" ||
          typeof f.contents !== "string" ||
          f.path.includes("..") ||
          path.isAbsolute(f.path)
        ) {
          res.status(400).json({ error: "invalid files payload" });
          return;
        }
        seedFiles.push({ path: f.path, contents: f.contents });
      }
      if (seedFiles.length > 200) {
        res.status(400).json({ error: "too many files" });
        return;
      }
    }

    let repoUrl;
    if (rawRepoUrl !== undefined) {
      try {
        repoUrl = normalizeRepoUrl(rawRepoUrl);
      } catch (err) {
        res.status(400).json({ error: err.message });
        return;
      }
    }

    if (repoUrl && seedFiles) {
      res.status(400).json({ error: "pass repoUrl or files, not both" });
      return;
    }

    const id = safeId(workflowId);
    const containerName = `manycat-sandbox-${id}`;
    const wsPath = workspacePath(id);

    if (seedFiles && seedFiles.length > 0) {
      try {
        await writeSeedFiles(wsPath, seedFiles);
        await initVirtualGit(wsPath, typeof prompt === "string" ? prompt : "manycat scaffold");
      } catch (err) {
        res.status(500).json({ error: err.message, stage: "seed" });
        return;
      }
    } else if (repoUrl && fs.readdirSync(wsPath).length === 0) {
      try {
        await cloneRepo(repoUrl, wsPath);
      } catch (err) {
        fs.rmSync(wsPath, { recursive: true, force: true });
        fs.mkdirSync(wsPath, { recursive: true });
        res.status(502).json({ error: err.message, stage: "clone" });
        return;
      }
    }

    // Production control plane often has no docker.sock — keep the seeded
    // workspace so Manycat can still create virtual projects + agent runs.
    const hasDocker = await dockerAvailable();
    if (!hasDocker) {
      sandboxes.set(id, { mode: "workspace-only", accountId });
      res.status(201).json({
        workflowId: id,
        status: "workspace-only",
        workspacePath: wsPath,
        accountId,
        warning: "Docker unavailable; workspace written without preview container",
      });
      return;
    }

    const reused = await reconcileExisting(containerName);
    if (reused) {
      sandboxes.set(id, {
        containerId: reused.containerId,
        hostPort: reused.hostPort,
        accountId,
        mode: "container",
      });
      usedPorts.add(reused.hostPort);
      res.json({
        workflowId: id,
        status: "running",
        hostPort: reused.hostPort,
        previewUrl: `http://${PREVIEW_HOST}:${reused.hostPort}`,
        accountId,
      });
      return;
    }

    const hostPort = allocatePort();
    const hostWsPath = path.join(HOST_WORKSPACE_ROOT, id);
    const spec = containerSpec(containerName, hostPort, hostWsPath);

    let container;
    try {
      container = await createAndStart(spec);
    } catch (err) {
      if (err.statusCode !== 409) {
        // Seeded workspace is still useful without a preview container.
        releasePort(hostPort);
        sandboxes.set(id, { mode: "workspace-only", accountId });
        res.status(201).json({
          workflowId: id,
          status: "workspace-only",
          workspacePath: wsPath,
          accountId,
          warning: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // Race: another request created it between our check and this call.
      const raced = await reconcileExisting(containerName);
      if (raced) {
        releasePort(hostPort);
        sandboxes.set(id, {
          containerId: raced.containerId,
          hostPort: raced.hostPort,
          accountId,
          mode: "container",
        });
        usedPorts.add(raced.hostPort);
        res.json({
          workflowId: id,
          status: "running",
          hostPort: raced.hostPort,
          previewUrl: `http://${PREVIEW_HOST}:${raced.hostPort}`,
          accountId,
        });
        return;
      }
      container = await createAndStart(spec);
    }

    sandboxes.set(id, {
      containerId: container.id,
      hostPort,
      accountId,
      mode: "container",
    });

    res.status(201).json({
      workflowId: id,
      status: "running",
      hostPort,
      previewUrl: `http://${PREVIEW_HOST}:${hostPort}`,
      workspacePath: wsPath,
      accountId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/sandboxes/:id/files", async (req, res) => {
  const id = safeId(req.params.id);
  const dir = path.join(WORKSPACE_ROOT, id);
  if (!fs.existsSync(dir)) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  try {
    const files = await walkWorkspace(dir);
    res.json({ workflowId: id, files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/sandboxes/:id/files", async (req, res) => {
  const id = safeId(req.params.id);
  const rawFiles = req.body?.files;
  if (!Array.isArray(rawFiles)) {
    res.status(400).json({ error: "files array required" });
    return;
  }
  if (rawFiles.length > 400) {
    res.status(400).json({ error: "too many files" });
    return;
  }

  /** @type {{ path: string, contents: string }[]} */
  const files = [];
  for (const f of rawFiles) {
    if (
      !f ||
      typeof f.path !== "string" ||
      typeof f.contents !== "string" ||
      f.path.includes("..") ||
      path.isAbsolute(f.path)
    ) {
      res.status(400).json({ error: "invalid files payload" });
      return;
    }
    files.push({ path: f.path, contents: f.contents });
  }

  const dir = workspacePath(id);
  try {
    await writeSeedFiles(dir, files);
    if (!sandboxes.has(id)) {
      sandboxes.set(id, { mode: "workspace-only" });
    }
    res.json({ workflowId: id, status: "updated", fileCount: files.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const EXEC_MAX_BYTES = 200_000;

app.post("/sandboxes/:id/exec", async (req, res) => {
  const id = safeId(req.params.id);
  const record = sandboxes.get(id);
  if (!record) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }
  if (record.mode === "workspace-only" || !record.containerId) {
    res.status(503).json({
      error: "Sandbox is workspace-only (no Docker container); exec unavailable",
    });
    return;
  }

  const { command, timeoutMs } = req.body;
  if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === "string")) {
    res.status(400).json({ error: "command must be a non-empty string array" });
    return;
  }
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30_000;

  try {
    const container = docker.getContainer(record.containerId);
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});

    const chunks = [];
    let bytes = 0;
    const collect = {
      write(chunk) {
        if (bytes >= EXEC_MAX_BYTES) return;
        const slice = chunk.subarray(0, EXEC_MAX_BYTES - bytes);
        chunks.push(slice);
        bytes += slice.length;
      },
    };

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error("exec timed out"));
      }, timeout);
      docker.modem.demuxStream(stream, collect, collect);
      stream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const info = await exec.inspect();
    res.json({
      exitCode: info.ExitCode,
      output: Buffer.concat(chunks).toString("utf8"),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/sandboxes/:id", async (req, res) => {
  const id = safeId(req.params.id);
  const record = sandboxes.get(id);
  if (!record) {
    // Workspace may still exist on disk from a prior workspace-only create.
    const dir = path.join(WORKSPACE_ROOT, id);
    if (fs.existsSync(dir)) {
      res.json({ workflowId: id, status: "workspace-only" });
      return;
    }
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  if (record.mode === "workspace-only" || !record.containerId) {
    res.json({ workflowId: id, status: "workspace-only", accountId: record.accountId });
    return;
  }

  try {
    const container = docker.getContainer(record.containerId);
    const info = await container.inspect();
    const running = info.State.Running;
    res.json({
      workflowId: id,
      status: running ? "running" : info.State.Status,
      hostPort: record.hostPort,
      previewUrl: `http://${PREVIEW_HOST}:${record.hostPort}`,
    });
  } catch {
    sandboxes.delete(id);
    releasePort(record.hostPort);
    res.status(404).json({ error: "Sandbox not found" });
  }
});

app.delete("/sandboxes/:id", async (req, res) => {
  const id = safeId(req.params.id);
  const record = sandboxes.get(id);
  const dir = path.join(WORKSPACE_ROOT, id);

  if (!record) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      res.json({ workflowId: id, status: "removed" });
      return;
    }
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }

  if (record.mode === "workspace-only" || !record.containerId) {
    sandboxes.delete(id);
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ workflowId: id, status: "removed" });
    return;
  }

  try {
    const container = docker.getContainer(record.containerId);
    try {
      await container.stop({ t: 5 });
    } catch {
      /* already stopped */
    }
    await container.remove({ force: true });
  } catch (err) {
    console.error(err);
  }

  sandboxes.delete(id);
  releasePort(record.hostPort);
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ workflowId: id, status: "removed" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`sandbox-orchestrator listening on :${port}`);
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
});
