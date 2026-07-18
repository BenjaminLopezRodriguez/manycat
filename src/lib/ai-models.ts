/**
 * Client + server catalog of models Manycat can actually run.
 * UI ids map to LangChain / harness model strings.
 */

export const EFFORT_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
] as const;

export type EffortId = (typeof EFFORT_LEVELS)[number]["id"];

export const AI_MODELS = [
  {
    id: "auto",
    label: "Auto",
    description: "Modal coder when configured, else GPT-4o",
    langchainModel: "auto",
    provider: "auto" as const,
  },
  {
    id: "qwen-coder",
    label: "Qwen2.5 Coder",
    description: "Open-weight on Modal (vLLM)",
    langchainModel: "openai:coder",
    provider: "modal" as const,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    description: "OpenAI",
    langchainModel: "gpt-4o",
    provider: "openai" as const,
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet",
    description: "Anthropic",
    langchainModel: "anthropic:claude-sonnet-4-20250514",
    provider: "anthropic" as const,
  },
] as const;

export type ModelId = (typeof AI_MODELS)[number]["id"];

/** Image models for Create mode (UI catalog; harness may map later). */
export const IMAGE_MODELS = [
  {
    id: "auto",
    label: "Auto",
    description: "Best available image model",
  },
  {
    id: "nanobanana",
    label: "Nano Banana",
    description: "Fast concept sketches",
  },
  {
    id: "midjourney",
    label: "Midjourney",
    description: "Stylized, cinematic",
  },
  {
    id: "flux",
    label: "FLUX",
    description: "High-fidelity diffusion",
  },
  {
    id: "dall-e-3",
    label: "DALL·E 3",
    description: "OpenAI images",
  },
  {
    id: "stable-diffusion",
    label: "Stable Diffusion",
    description: "Open-weight classic",
  },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export const IMAGE_CANDIDATE_COUNTS = [1, 2, 3, 4, 5] as const;
export type ImageCandidateCount = (typeof IMAGE_CANDIDATE_COUNTS)[number];
export const DEFAULT_IMAGE_CANDIDATES: ImageCandidateCount = 2;

export function isModelId(value: string): value is ModelId {
  return AI_MODELS.some((m) => m.id === value);
}

export function isImageModelId(value: string): value is ImageModelId {
  return IMAGE_MODELS.some((m) => m.id === value);
}

export function isEffortId(value: string): value is EffortId {
  return EFFORT_LEVELS.some((e) => e.id === value);
}

/** Agent + sampling knobs driven by the Effort slider. */
export const EFFORT_PRESETS: Record<
  EffortId,
  {
    maxTurns: number;
    recursionLimit: number;
    temperature: number;
    maxTokens: number;
  }
> = {
  low: { maxTurns: 12, recursionLimit: 24, temperature: 0.5, maxTokens: 1024 },
  medium: {
    maxTurns: 24,
    recursionLimit: 48,
    temperature: 0.35,
    maxTokens: 2048,
  },
  high: { maxTurns: 40, recursionLimit: 80, temperature: 0.2, maxTokens: 4096 },
  max: { maxTurns: 80, recursionLimit: 160, temperature: 0.1, maxTokens: 8192 },
};

export function resolveLangchainModel(
  modelId: ModelId,
  opts?: { preferModalCoder?: boolean },
): string {
  if (modelId === "auto") {
    return opts?.preferModalCoder ? "openai:coder" : "gpt-4o";
  }
  const found = AI_MODELS.find((m) => m.id === modelId);
  return found?.langchainModel ?? "gpt-4o";
}
