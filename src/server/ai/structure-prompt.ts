import { env } from "@/env";

const SYSTEM_PROMPT =
  "You expand a user's one-line app request into a clear, structured build " +
  "spec for a coding agent. List the pages/sections, key features, and any " +
  "stated tone or style. Be concrete and concise (under 200 words). Output " +
  "only the spec — no preamble, no markdown headers.";

/**
 * Expands a raw prompt into a structured build spec via OpenAI before handoff
 * to the agent-harness codegen model (Modal-hosted Qwen coder). Falls back to
 * the raw prompt untouched when no key is configured or the call fails —
 * structuring is a quality boost, not a dependency generation should block on.
 */
export async function structurePrompt(rawPrompt: string): Promise<string> {
  if (!env.OPENAI_API_KEY) return rawPrompt;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: rawPrompt },
        ],
      }),
    });
    if (!res.ok) return rawPrompt;

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content?.trim() ?? rawPrompt;
  } catch {
    return rawPrompt;
  }
}
