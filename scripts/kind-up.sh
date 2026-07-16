#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-manycat}"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind is required: https://kind.sigs.k8s.io/docs/user/quick-start/"
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required"
  exit 1
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "kind cluster '$CLUSTER_NAME' already exists"
else
  kind create cluster --name "$CLUSTER_NAME" --config "$ROOT/scripts/kind-config.yaml"
fi

echo "Building images..."
docker build -t manycat-app:local "$ROOT"
docker build -t manycat-agent:local "$ROOT/agent-harness"
docker build -t manycat-orchestrator:local "$ROOT/infra/sandbox-orchestrator"
docker build -t manycat-sandbox:latest -f "$ROOT/infra/sandbox/Dockerfile.sandbox" "$ROOT/infra/sandbox"

echo "Loading images into kind..."
kind load docker-image manycat-app:local --name "$CLUSTER_NAME"
kind load docker-image manycat-agent:local --name "$CLUSTER_NAME"
kind load docker-image manycat-orchestrator:local --name "$CLUSTER_NAME"
kind load docker-image manycat-sandbox:latest --name "$CLUSTER_NAME"

echo "Applying manifests..."
kubectl apply -k "$ROOT/k8s/overlays/local"

echo "Done. App NodePort: http://localhost:3000 (maps to 30000)"
echo "Orchestrator NodePort: http://localhost:8080 (maps to 30080)"
