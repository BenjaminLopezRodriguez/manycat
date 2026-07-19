# Open-weight coder on Modal

GPU vLLM endpoint for Manycat’s agent-harness. Railway stays CPU/app-only — weights live here.

## Deploy

```bash
pip install modal
modal setup
modal deploy infra/modal/serve_coder.py
```

Copy the HTTPS URL Modal prints (ends with something like `…-serve.modal.run`).

Gated Hugging Face models:

```bash
modal secret create huggingface HF_TOKEN=hf_...
```

Then add `secrets=[modal.Secret.from_name("huggingface")]` to `@app.function` in `serve_coder.py` and redeploy.

## Evaluator (website QA)

Separate Modal app the Build agent must call via `report_to_evaluator` after
`browser_check` / `read_app_logs`:

```bash
modal deploy infra/modal/serve_eval.py
```

Wire on **agent-harness** (Railway / Compose), not Vercel:

```bash
MODAL_EVAL_URL=https://benjaminlopezrodriguez--openweight-eval-serve.modal.run/v1
EVAL_MODEL_NAME=eval
SANDBOX_ORCHESTRATOR_URL=https://your-orchestrator…   # for read_app_logs
```

Deployed evaluator endpoint (this workspace):

`https://benjaminlopezrodriguez--openweight-eval-serve.modal.run/v1`

Smoke (cold start can take several minutes on first request):

```bash
curl "$MODAL_EVAL_URL/models"
```

## Effort (agent → Modal)

The Manycat UI Effort slider (`low` | `medium` | `high` | `max`) is sent on every `/run` call. The harness maps it to:

| Effort | max_tokens | temperature | agent turns |
|--------|------------|-------------|-------------|
| low | 1024 | 0.5 | 12 |
| medium | 2048 | 0.35 | 24 |
| high | 4096 | 0.2 | 40 |
| max | 8192 | 0.1 | 80 |

Those sampling params are passed to the OpenAI-compatible Modal/vLLM endpoint on each completion. No Modal redeploy is required when changing effort — it is per-request.

Wire agent-harness:

In `.env` / Compose / Railway control-plane agent service:

```bash
MODEL=openai:coder
OPENAI_BASE_URL=https://YOUR-MODAL-URL/v1
OPENAI_API_KEY=local-dev-key   # required by OpenAI client; Modal stub does not validate it
```

Smoke test:

```bash
curl "$OPENAI_BASE_URL/models"
curl "$OPENAI_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"write a hello world in python"}]}'
```

## Model / GPU knobs

Edit `infra/modal/serve_coder.py`:

| Knob | Default | Notes |
|------|---------|--------|
| `MODEL_NAME` | `Qwen/Qwen2.5-Coder-7B-Instruct` | Swap HF id |
| `GPU` | `L4:1` | Use `A100` / `H100` for 32B+ |
| `scaledown_window` | 10 min | Idle GPU cost control |

## Security

The Modal web endpoint is public by default. For production, put a shared secret in front (Modal proxy auth, Cloudflare Access, or a tiny auth gateway) and do not reuse control-plane tokens. Never put Modal GPU credentials into Railway **workload** user services.
