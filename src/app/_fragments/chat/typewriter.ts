/**
 * Reveal `fullText` progressively (char stream-in). Short replies feel
 * character-by-character; long blocks accelerate so they finish in ~3s.
 */
export async function typewriterReveal(
  fullText: string,
  onUpdate: (partial: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  if (!fullText) {
    onUpdate("");
    return;
  }

  const targetFrames = 60 * 3;
  const charsPerFrame = Math.max(1, Math.ceil(fullText.length / targetFrames));
  let i = 0;

  while (i < fullText.length) {
    if (opts?.signal?.aborted) {
      onUpdate(fullText);
      return;
    }
    i = Math.min(fullText.length, i + charsPerFrame);
    onUpdate(fullText.slice(0, i));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}
