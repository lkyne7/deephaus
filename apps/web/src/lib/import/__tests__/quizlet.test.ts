import { describe, expect, it } from "vitest";
import { parseQuizletExport } from "@/lib/import/quizlet";

describe("parseQuizletExport", () => {
  it("parses Quizlet's default tab-separated export", () => {
    expect(
      parseQuizletExport("Mitochondria\tProduces ATP\nRibosome\tBuilds proteins"),
    ).toEqual([
      { term: "Mitochondria", definition: "Produces ATP" },
      { term: "Ribosome", definition: "Builds proteins" },
    ]);
  });

  it("parses quoted CSV values and removes a header", () => {
    expect(
      parseQuizletExport('Term,Definition\n"Comma, term","A ""quoted"" answer"'),
    ).toEqual([
      { term: "Comma, term", definition: 'A "quoted" answer' },
    ]);
  });

  it("preserves multiline quoted definitions", () => {
    expect(
      parseQuizletExport('"First term","Line one\nLine two"\nSecond,Answer'),
    ).toEqual([
      { term: "First term", definition: "Line one\nLine two" },
      { term: "Second", definition: "Answer" },
    ]);
  });

  it("skips incomplete rows", () => {
    expect(parseQuizletExport("Complete\tAnswer\nMissing answer\n\tMissing term")).toEqual([
      { term: "Complete", definition: "Answer" },
    ]);
  });
});
