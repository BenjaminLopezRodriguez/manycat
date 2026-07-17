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

## Wire agent-harness

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
