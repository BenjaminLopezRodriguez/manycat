import express from "express";
import Docker from "dockerode";
import fs from "node:fs";
import path from "node:path";

const app = express();
app.use(express.json());

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/workspaces";
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "manycat-sandbox:latest";
const PORT_MIN = Number(process.env.SANDBOX_PORT_MIN ?? 4000);
const PORT_MAX = Number(process.env.SANDBOX_PORT_MAX ?? 4999);
const PREVIEW_HOST = process.env.PREVIEW_HOST ?? "localhost";

/** @type {Map<string, { containerId: string, hostPort: number }>} */
const sandboxes = new Map();

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", sandboxes: sandboxes.size });
});

app.post("/sandboxes", async (req, res) => {
  try {
    const { workflowId } = req.body;
    if (!workflowId || typeof workflowId !== "string") {
      res.status(400).json({ error: "workflowId required" });
      return;
    }

    const id = safeId(workflowId);
    if (sandboxes.has(id)) {
      const existing = sandboxes.get(id);
      res.json({
        workflowId: id,
        status: "running",
        hostPort: existing.hostPort,
        previewUrl: `http://${PREVIEW_HOST}:${existing.hostPort}`,
      });
      return;
    }

    const hostPort = allocatePort();
    const wsPath = workspacePath(id);
    const containerName = `manycat-sandbox-${id}`;

    const container = await docker.createContainer({
      name: containerName,
      Image: SANDBOX_IMAGE,
      Env: [`PORT=3000`],
      ExposedPorts: { "3000/tcp": {} },
      HostConfig: {
        Binds: [`${wsPath}:/workspace`],
        PortBindings: {
          "3000/tcp": [{ HostPort: String(hostPort) }],
        },
        AutoRemove: false,
      },
    });

    await container.start();
    sandboxes.set(id, { containerId: container.id, hostPort });

    res.status(201).json({
      workflowId: id,
      status: "running",
      hostPort,
      previewUrl: `http://${PREVIEW_HOST}:${hostPort}`,
      workspacePath: wsPath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/sandboxes/:id", async (req, res) => {
  const id = safeId(req.params.id);
  const record = sandboxes.get(id);
  if (!record) {
    res.status(404).json({ error: "Sandbox not found" });
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
  if (!record) {
    res.status(404).json({ error: "Sandbox not found" });
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
  res.json({ workflowId: id, status: "removed" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`sandbox-orchestrator listening on :${port}`);
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
});
