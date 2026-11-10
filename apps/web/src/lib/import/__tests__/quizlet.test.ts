import { describe, expect, it } from "vitest";
import {
  describeSkippedRows,
  parseQuizletExport,
  parseQuizletImport,
} from "@/lib/import/quizlet";

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

describe("parseQuizletImport quotes", () => {
  it("keeps an inch mark without swallowing the next card", () => {
    expect(parseQuizletImport('1\tFirst\n2\tA 6" ruler\n3\tThird')).toEqual({
      cards: [
        { term: "1", definition: "First" },
        { term: "2", definition: 'A 6" ruler' },
        { term: "3", definition: "Third" },
      ],
      skipped: [],
    });
  });

  it("keeps quotes in the middle of tab-separated fields", () => {
    expect(
      parseQuizletExport('What is "DNA"?\tA molecule\nHe said "hi".\tGreeting\nSecond\tAnswer'),
    ).toEqual([
      { term: 'What is "DNA"?', definition: "A molecule" },
      { term: 'He said "hi".', definition: "Greeting" },
      { term: "Second", definition: "Answer" },
    ]);
  });

  it("keeps quotes that open a tab-separated field", () => {
    expect(
      parseQuizletExport('"DNA" stands for\tDeoxyribonucleic acid\n"Hello"\t"Greeting"\nLast\t"Quoted" answer'),
    ).toEqual([
      { term: '"DNA" stands for', definition: "Deoxyribonucleic acid" },
      { term: '"Hello"', definition: '"Greeting"' },
      { term: "Last", definition: '"Quoted" answer' },
    ]);
  });

  it("keeps an unmatched opening quote as text", () => {
    expect(parseQuizletExport('"Open quote\tAnswer\nNext\tCard')).toEqual([
      { term: '"Open quote', definition: "Answer" },
      { term: "Next", definition: "Card" },
    ]);
  });

  it("reads tab-separated fields quoted by a spreadsheet", () => {
    expect(
      parseQuizletExport('"Line one\nLine two"\tAnswer\nTerm\t"He said ""hi"""\n"Tab\there"\tOK'),
    ).toEqual([
      { term: "Line one\nLine two", definition: "Answer" },
      { term: "Term", definition: 'He said "hi"' },
      { term: "Tab\there", definition: "OK" },
    ]);
  });

  it("keeps quotes inside unquoted CSV fields", () => {
    expect(parseQuizletExport('Ruler,A 6" ruler\nQuote,"He said ""hi"""\nNext,Card')).toEqual([
      { term: "Ruler", definition: 'A 6" ruler' },
      { term: "Quote", definition: 'He said "hi"' },
      { term: "Next", definition: "Card" },
    ]);
  });

  it("treats a malformed quoted CSV field as text instead of merging rows", () => {
    expect(parseQuizletExport('"Broken" field,Answer\nNext,Card')).toEqual([
      { term: '"Broken" field', definition: "Answer" },
      { term: "Next", definition: "Card" },
    ]);
  });

  it("handles CRLF, a byte order mark, Unicode and a trailing newline", () => {
    expect(parseQuizletExport('﻿café\tcoffee ☕\r\nÄpfel\t"Æble" på dansk\r\n')).toEqual([
      { term: "café", definition: "coffee ☕" },
      { term: "Äpfel", definition: '"Æble" på dansk' },
    ]);
  });
});

describe("parseQuizletImport skipped rows", () => {
  it("reports blank terms and definitions by line", () => {
    expect(parseQuizletImport("1\tFirst\n2\t\n3\tThird\n\tNo term")).toEqual({
      cards: [
        { term: "1", definition: "First" },
        { term: "3", definition: "Third" },
      ],
      skipped: [
        { line: 2, reason: "missing_definition" },
        { line: 4, reason: "missing_term" },
      ],
    });
  });

  it("reports a one-column row among valid rows", () => {
    const parsed = parseQuizletImport("term\tdef\nbroken line\nsecond\tanswer");
    expect(parsed.cards).toEqual([
      { term: "term", definition: "def" },
      { term: "second", definition: "answer" },
    ]);
    expect(parsed.skipped).toEqual([{ line: 2, reason: "missing_definition" }]);
  });

  it("ignores blank separator lines", () => {
    expect(parseQuizletImport("A\tB\n\n   \n\t\nC\tD\n")).toEqual({
      cards: [
        { term: "A", definition: "B" },
        { term: "C", definition: "D" },
      ],
      skipped: [],
    });
  });

  it("numbers lines after multiline quoted values", () => {
    expect(parseQuizletImport('"Multi\nline",Answer\nBroken\nOK,Fine').skipped).toEqual([
      { line: 3, reason: "missing_definition" },
    ]);
  });

  it("does not report the header row", () => {
    expect(parseQuizletImport("Term\tDefinition\nA\tB").skipped).toEqual([]);
  });
});

describe("describeSkippedRows", () => {
  it("names one line", () => {
    expect(describeSkippedRows([{ line: 2, reason: "missing_definition" }])).toBe(
      "The row on line 2 is missing a term or definition.",
    );
  });

  it("lists several lines and truncates long lists", () => {
    const rows = [2, 5, 9].map((line) => ({ line, reason: "missing_term" as const }));
    expect(describeSkippedRows(rows)).toBe(
      "The rows on lines 2, 5 and 9 are missing a term or definition.",
    );
    expect(describeSkippedRows(rows, 2)).toBe(
      "The rows on lines 2, 5 and 1 more are missing a term or definition.",
    );
  });
});
