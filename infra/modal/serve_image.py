"""
Open-weight image generation on Modal (SDXL-Turbo, diffusers).
Backs the "create" shell mode's Gallery / New composer.

Deploy:
  modal deploy infra/modal/serve_image.py

Then point Next.js at the printed URL:
  MODAL_IMAGE_URL=https://<workspace>--openweight-image-imagemodel-generate.modal.run

POST body: {"prompt": "..."}
Response:  {"image_base64": "...", "content_type": "image/png"}

# ponytail: FLUX.1-schnell is gated on HF (needs an accepted license + token)
# — SDXL-Turbo is fully open, no auth, and small enough for L4. Swap to FLUX
# later via `modal secret create huggingface HF_TOKEN=hf_...` +
# secrets=[modal.Secret.from_name("huggingface")] if quality needs it.
"""

from __future__ import annotations

import modal

APP_NAME = "openweight-image"
MODEL_NAME = "stabilityai/sdxl-turbo"
GPU = "L4:1"
MINUTES = 60

app = modal.App(APP_NAME)

model_cache = modal.Volume.from_name("manycat-image-model-cache", create_if_missing=True)

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.4.0",
    "diffusers==0.30.0",
    "transformers==4.44.0",
    "accelerate==0.33.0",
    "sentencepiece==0.2.0",
    "protobuf==5.27.3",
    "fastapi[standard]==0.115.4",
)


@app.cls(
    image=image,
    gpu=GPU,
    timeout=10 * MINUTES,
    scaledown_window=10 * MINUTES,
    volumes={"/root/.cache/huggingface": model_cache},
)
@modal.concurrent(max_inputs=4)
class ImageModel:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import AutoPipelineForText2Image

        self.pipe = AutoPipelineForText2Image.from_pretrained(
            MODEL_NAME, torch_dtype=torch.float16, variant="fp16"
        )
        self.pipe.to("cuda")

    @modal.fastapi_endpoint(method="POST")
    def generate(self, body: dict):
        import base64
        import io

        prompt = (body or {}).get("prompt", "").strip()
        if not prompt:
            return {"error": "prompt required"}

        result = self.pipe(
            prompt,
            num_inference_steps=1,
            guidance_scale=0.0,
        )
        buf = io.BytesIO()
        result.images[0].save(buf, format="PNG")
        return {
            "image_base64": base64.b64encode(buf.getvalue()).decode(),
            "content_type": "image/png",
        }
