import { env } from "@/env";

export function isImageModelConfigured(): boolean {
  return Boolean(env.MODAL_IMAGE_URL);
}

/** Generates a PNG from the Modal-hosted FLUX.1-schnell endpoint. Returns a data: URL. */
export async function runImageGeneration(prompt: string): Promise<string> {
  if (!env.MODAL_IMAGE_URL) {
    throw new Error("Image model is not configured (MODAL_IMAGE_URL missing)");
  }

  const res = await fetch(env.MODAL_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    throw new Error(`Image model error (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as {
    image_base64?: string;
    content_type?: string;
    error?: string;
  };
  if (body.error) throw new Error(body.error);
  if (!body.image_base64) throw new Error("Image model returned no image");

  return `data:${body.content_type ?? "image/png"};base64,${body.image_base64}`;
}
