import { describe, expect, it } from "vitest";
import {
  classifyCreateInput,
  deckTitleFromFile,
  deckTitleFromInput,
  normalizeUrl,
  truncateTitle,
} from "../lib/create-input";

describe("classifyCreateInput", () => {
  it("waits for enough text", () => {
    expect(classifyCreateInput("")).toBeNull();
    expect(classifyCreateInput("   ")).toBeNull();
    expect(classifyCreateInput("ab")).toBeNull();
  });

  it("treats a short line as a topic", () => {
    expect(classifyCreateInput("The Krebs cycle")).toBe("topic");
  });

  it("spots YouTube links in their common forms", () => {
    expect(classifyCreateInput("https://www.youtube.com/watch?v=abc123")).toBe("youtube");
    expect(classifyCreateInput("https://youtu.be/abc123")).toBe("youtube");
    expect(classifyCreateInput("youtube.com/watch?v=abc123")).toBe("youtube");
    expect(classifyCreateInput("  https://m.youtube.com/watch?v=abc123\n")).toBe("youtube");
  });

  it("spots other links", () => {
    expect(classifyCreateInput("https://example.edu/biology/respiration")).toBe("website");
    expect(classifyCreateInput("www.example.edu/biology")).toBe("website");
  });

  it("does not mistake a sentence containing a link for a link", () => {
    expect(classifyCreateInput("see https://example.edu for details")).toBe("topic");
  });

  it("treats long or multi-line text as notes", () => {
    expect(classifyCreateInput("word ".repeat(50))).toBe("notes");
    expect(classifyCreateInput("Mitosis\nMeiosis")).toBe("notes");
  });
});

describe("normalizeUrl", () => {
  it("adds a scheme only when missing", () => {
    expect(normalizeUrl("www.example.edu")).toBe("https://www.example.edu");
    expect(normalizeUrl(" http://example.edu ")).toBe("http://example.edu");
  });

  it("lowers only the scheme a keyboard capitalised", () => {
    expect(normalizeUrl("Https://youtu.be/AbC123")).toBe("https://youtu.be/AbC123");
  });
});

describe("truncateTitle", () => {
  it("cuts at a word and never leaves stray punctuation", () => {
    expect(truncateTitle("Meiosis halves the chromosome number to make gametes, always", 40)).toBe(
      "Meiosis halves the chromosome number…",
    );
  });

  it("leaves short titles alone", () => {
    expect(truncateTitle("Chapter 1")).toBe("Chapter 1");
  });
});

describe("deck titles", () => {
  it("capitalises a topic", () => {
    expect(deckTitleFromInput("topic", "the krebs cycle")).toBe("The krebs cycle");
  });

  it("uses the first line of notes", () => {
    expect(deckTitleFromInput("notes", "Lecture 7\nThe electron transport chain")).toBe("Lecture 7");
  });

  it("names links by their site", () => {
    expect(deckTitleFromInput("website", "https://www.example.edu/biology?x=1")).toBe("example.edu");
    expect(deckTitleFromInput("youtube", "https://youtu.be/abc123")).toBe("YouTube video");
  });

  it("drops the extension and separators from a file name", () => {
    expect(deckTitleFromFile("lecture_7-notes.pdf")).toBe("lecture 7 notes");
    expect(deckTitleFromFile("/tmp/Chapter 1.docx")).toBe("Chapter 1");
    expect(deckTitleFromFile(".pdf")).toBe(".pdf");
  });
});
