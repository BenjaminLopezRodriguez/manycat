import type { EffortId } from "@/lib/ai-models";
import { runChatCompletion, type ChatMessage } from "@/server/ai/modal-chat";

export type ResearchSource = { title: string; url: string; snippet: string };

// ponytail: keyless public API (export.arxiv.org) — matches "arxiv" from the
// ask directly and needs no new secret. Swap/add providers here if broader
// peer-reviewed coverage (Semantic Scholar, etc.) is needed later.
const EFFORT_SOURCE_COUNT: Record<EffortId, number> = {
  low: 2,
  medium: 3,
  high: 4,
  max: 5,
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type ArxivPaper = { title: string; url: string; summary: string };

async function searchArxiv(query: string, count: number): Promise<ArxivPaper[]> {
  const url =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}` +
    `&start=0&max_results=${count}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`arXiv search failed (${res.status})`);
  const xml = await res.text();

  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, count)
    .map((match) => {
      const entry = match[1]!;
      const title = stripHtml(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? "Untitled");
      const summary = stripHtml(/<summary>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? "");
      const id = /<id>([\s\S]*?)<\/id>/.exec(entry)?.[1]?.trim() ?? "";
      return { title, url: id.replace(/^http:/, "https:"), summary };
    })
    .filter((p) => p.url);
}

/** Fetches the actual arXiv abstract page — real link reads, not just API metadata. */
async function readAbstractPage(url: string, fallbackSummary: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallbackSummary;
    const html = await res.text();
    const block = /<blockquote[^>]*class="abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i.exec(
      html,
    )?.[1];
    const text = stripHtml(block ?? html);
    return text.length > 0 ? text : fallbackSummary;
  } catch {
    return fallbackSummary;
  }
}

export async function runDeepResearch(opts: {
  prompt: string;
  history: ChatMessage[];
  effort: EffortId;
}): Promise<{ reply: string; sources: ResearchSource[] }> {
  const count = EFFORT_SOURCE_COUNT[opts.effort] ?? 3;

  let papers: ArxivPaper[] = [];
  try {
    papers = await searchArxiv(opts.prompt, count);
  } catch {
    papers = [];
  }

  if (papers.length === 0) {
    const reply = await runChatCompletion([
      {
        role: "system",
        content:
          "You are Manycat's research assistant. arXiv could not be reached for this " +
          "question — answer from general knowledge and say sources weren't available.",
      },
      ...opts.history,
      { role: "user", content: opts.prompt },
    ]);
    return { reply, sources: [] };
  }

  const snippets = await Promise.all(
    papers.map((p) => readAbstractPage(p.url, p.summary)),
  );
  const sources: ResearchSource[] = papers.map((p, i) => ({
    title: p.title,
    url: p.url,
    snippet: snippets[i]!.slice(0, 400),
  }));

  const context = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`)
    .join("\n\n");

  const reply = await runChatCompletion([
    {
      role: "system",
      content:
        "You are Manycat's deep-research assistant. Answer the user's question using ONLY " +
        "the numbered sources below, citing them inline like [1] or [2]. If the sources " +
        `don't cover something, say so instead of guessing.\n\nSources:\n${context}`,
    },
    ...opts.history,
    { role: "user", content: opts.prompt },
  ]);

  return { reply, sources };
}
