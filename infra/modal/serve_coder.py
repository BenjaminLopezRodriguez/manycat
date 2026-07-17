"""
Open-weight coding model on Modal (vLLM, OpenAI-compatible).

Deploy:
  pip install modal
  modal setup
  modal deploy infra/modal/serve_coder.py

Optional gated HF models:
  modal secret create huggingface HF_TOKEN=hf_...

Then point agent-harness at the printed URL:
  OPENAI_BASE_URL=https://<workspace>--openweight-coder-serve.modal.run/v1
  OPENAI_API_KEY=not-needed-or-any-string
  MODEL=openai:coder
"""

from __future__ import annotations

import json
import subprocess

import modal

APP_NAME = "openweight-coder"
MODEL_NAME = "Qwen/Qwen2.5-Coder-7B-Instruct"
SERVED_NAME = "coder"
VLLM_PORT = 8000
N_GPU = 1
GPU = f"L4:{N_GPU}"  # bump to A100/H100 for 32B+
MINUTES = 60

app = modal.App(APP_NAME)

hf_cache = modal.Volume.from_name("manycat-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("manycat-vllm-cache", create_if_missing=True)

vllm_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-devel-ubuntu22.04",
        add_python="3.11",
    )
    .entrypoint([])
    .pip_install("vllm==0.8.5", "huggingface-hub==0.30.2")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)


@app.function(
    image=vllm_image,
    gpu=GPU,
    timeout=30 * MINUTES,
    scaledown_window=10 * MINUTES,
    volumes={
        "/root/.cache/huggingface": hf_cache,
        "/root/.cache/vllm": vllm_cache,
    },
    # For gated HF models: modal secret create huggingface HF_TOKEN=hf_...
    # then: secrets=[modal.Secret.from_name("huggingface")],
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=VLLM_PORT, startup_timeout=30 * MINUTES)
def serve() -> None:
    cmd = [
        "vllm",
        "serve",
        MODEL_NAME,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--served-model-name",
        SERVED_NAME,
        "--tensor-parallel-size",
        str(N_GPU),
        "--gpu-memory-utilization",
        "0.90",
        # Required for agent harness tool loops (tool_choice=auto).
        "--enable-auto-tool-choice",
        "--tool-call-parser",
        "hermes",
    ]
    print("starting:", json.dumps(cmd))
    subprocess.Popen(cmd)
