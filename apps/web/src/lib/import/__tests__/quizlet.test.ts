import { describe, expect, it } from "vitest";
import { parseQuizletExport } from "@/lib/import/quizlet";

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

describe("parseQuizletExport", () => {
  it("parses a headerless two-column export without regression", () => {
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

  it("maps a realistic Dekki CSV header, tags, unicode, and multiline fields", () => {
    const rows = [
      ["biology, organelle", 'Produces "ATP", efficiently', "What is a mitochondrion?", "ignore me"],
      ["日本語 anatomy", "心臓 means heart", "What does 心臓 mean?", "ignore me"],
      ["tag-one tag-two", "Line one\nLine two", "Prompt, with comma", "ignore me"],
      ...Array.from({ length: 29 }, (_, index) => [
        `tag-${index}`,
        `Definition ${index}`,
        `Question ${index}`,
        `Unknown ${index}`,
      ]),
    ];
    const csv = [
      "TaGs,BaCk,FrOnT,Notes",
      ...rows.map((row) => row.map(csvCell).join(",")),
      "",
    ].join("\r\n");

    const cards = parseQuizletExport(csv);

    expect(cards).toHaveLength(32);
    expect(cards[0]).toEqual({
      term: "What is a mitochondrion?",
      definition: 'Produces "ATP", efficiently',
      tags: ["biology", "organelle"],
    });
    expect(cards[1]).toEqual({
      term: "What does 心臓 mean?",
      definition: "心臓 means heart",
      tags: ["日本語", "anatomy"],
    });
    expect(cards[2]).toEqual({
      term: "Prompt, with comma",
      definition: "Line one\nLine two",
      tags: ["tag-one", "tag-two"],
    });
    expect(cards.at(-1)).toEqual({
      term: "Question 28",
      definition: "Definition 28",
      tags: ["tag-28"],
    });
  });

  it("recognizes question and answer headers in TSV files", () => {
    expect(parseQuizletExport("qUeStIoN\taNsWeR\nWhat is ATP?\tCellular energy currency")).toEqual([
      { term: "What is ATP?", definition: "Cellular energy currency" },
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

  it("keeps legacy extra-column behavior for headerless files", () => {
    expect(parseQuizletExport("Prompt,Answer,Additional context")).toEqual([
      { term: "Prompt", definition: "Answer,Additional context" },
    ]);
  });
});
