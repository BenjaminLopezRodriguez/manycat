import { env } from "@/env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function isChatModelConfigured(): boolean {
  return Boolean(env.MODAL_CHAT_URL);
}

/** Plain chat completion against the Modal-hosted open-weight chat model. */
export async function runChatCompletion(messages: ChatMessage[]): Promise<string> {
  if (!env.MODAL_CHAT_URL) {
    throw new Error("Chat model is not configured (MODAL_CHAT_URL missing)");
  }

  const res = await fetch(`${env.MODAL_CHAT_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "chat",
      temperature: 0.5,
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Chat model error (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = body.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Chat model returned an empty response");
  return reply;
}
