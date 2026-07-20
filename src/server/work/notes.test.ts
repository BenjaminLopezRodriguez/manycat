import { describe, expect, it } from "vitest";

import { extractNotesHeuristic } from "./notes";

describe("extractNotesHeuristic", () => {
  it("picks lines with work-relevant keywords", () => {
    const notes = extractNotesHeuristic({
      text: "Hey team\nTom says the client wants to try the new japanese place\nok thanks",
    });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => /japanese/i.test(n.text))).toBe(true);
  });

  it("falls back to long lines when no keywords", () => {
    const notes = extractNotesHeuristic({
      text: "This is a reasonably long update about shipping status next week.",
    });
    expect(notes.length).toBe(1);
  });
});
