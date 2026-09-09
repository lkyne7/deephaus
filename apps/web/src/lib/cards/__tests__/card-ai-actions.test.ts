import { describe, expect, it } from "vitest";
import {
  createMockCardMnemonic,
  createMockRegeneratedCard,
  cueLetter,
  sanitizeRegeneratedCard,
} from "@deephaus/llm";

describe("cueLetter", () => {
  it("marks a cue letter bold + underlined like the AnKing decks", () => {
    expect(cueLetter("S")).toBe("<u>**S**</u>");
  });
});

describe("createMockCardMnemonic", () => {
  it("rewrites a basic card into the AnKing layout (same type)", () => {
    const { card } = createMockCardMnemonic({
      card: {
        type: "basic",
        front: "What are the causes of ARDS?",
        back: "Sepsis, pancreatitis, pneumonia, aspiration",
        cloze_text: null,
        extra: null,
      },
    });
    expect(card.front).toBe(
      'What are the causes of ARDS may be remembered with "SPPA". What does each letter stand for?',
    );
    expect(card.back).toBe(
      ["<u>**S**</u>epsis", "<u>**P**</u>ancreatitis", "<u>**P**</u>neumonia", "<u>**A**</u>spiration"].join("\n"),
    );
    expect(card.cloze_text).toBeNull();
    expect(card.extra).toBeNull();
  });

  it("rewrites a cloze card with the mnemonic and items as c1", () => {
    const { card } = createMockCardMnemonic({
      card: {
        type: "cloze",
        front: null,
        back: null,
        cloze_text: "Causes of ARDS include {{c1::sepsis}} and {{c2::shock::state}}.",
        extra: "Keep me",
      },
    });
    expect(card.front).toBeNull();
    expect(card.back).toBeNull();
    expect(card.cloze_text).toContain('may be remembered with "{{c1::SS}}":');
    expect(card.cloze_text).toContain("{{c1::<u>**S**</u>epsis}}");
    expect(card.cloze_text).toContain("{{c1::<u>**S**</u>hock}}");
    expect(card.extra).toBe("Keep me");
    // The result is a valid rewrite of the original.
    expect(
      sanitizeRegeneratedCard(
        { type: "cloze", front: null, back: null, cloze_text: "Causes of ARDS include {{c1::sepsis}}.", extra: null },
        card,
      ),
    ).not.toBeNull();
  });
});

describe("sanitizeRegeneratedCard", () => {
  const basic = {
    type: "basic" as const,
    front: "What is X?",
    back: "Y",
    cloze_text: null,
    extra: null,
  };

  it("accepts a changed basic card and nulls cloze fields", () => {
    expect(
      sanitizeRegeneratedCard(basic, {
        front: "Which thing is X?",
        back: "Y",
        cloze_text: "{{c1::junk}}",
        extra: "junk",
      }),
    ).toEqual({ front: "Which thing is X?", back: "Y", cloze_text: null, extra: null });
  });

  it("rejects a basic card missing a prompt or answer, or identical to the original", () => {
    expect(sanitizeRegeneratedCard(basic, { front: "", back: "Y", cloze_text: null, extra: null })).toBeNull();
    expect(sanitizeRegeneratedCard(basic, { front: "Q?", back: null, cloze_text: null, extra: null })).toBeNull();
    expect(
      sanitizeRegeneratedCard(basic, { front: " What is X? ", back: "Y ", cloze_text: null, extra: null }),
    ).toBeNull();
  });

  it("requires at least one deletion on cloze cards and repairs syntax", () => {
    const cloze = {
      type: "cloze" as const,
      front: null,
      back: null,
      cloze_text: "The {{c1::sun}} is a star.",
      extra: null,
    };
    expect(
      sanitizeRegeneratedCard(cloze, { front: null, back: null, cloze_text: "No deletions here.", extra: null }),
    ).toBeNull();
    expect(
      sanitizeRegeneratedCard(cloze, {
        front: "ignored",
        back: null,
        cloze_text: "Our nearest star is the {{c1:sun}.",
        extra: " ",
      }),
    ).toEqual({ front: null, back: null, cloze_text: "Our nearest star is the {{c1::sun}}.", extra: null });
  });

  it("keeps cue-letter markup inside cloze deletions intact", () => {
    const cloze = { type: "cloze" as const, front: null, back: null, cloze_text: "{{c1::Sepsis}}", extra: null };
    const text = 'Remembered with "{{c1::SP}}":\n\n{{c1::<u>**S**</u>epsis}}\n{{c1::<u>**P**</u>neumonia}}';
    expect(sanitizeRegeneratedCard(cloze, { front: null, back: null, cloze_text: text, extra: null })).toEqual({
      front: null,
      back: null,
      cloze_text: text,
      extra: null,
    });
  });
});

describe("createMockRegeneratedCard", () => {
  it("rewords the prompt but keeps the answer and type", () => {
    const { card } = createMockRegeneratedCard({
      card: { type: "basic", front: "What is X?", back: "Y", cloze_text: null, extra: null },
    });
    expect(card.front).toMatch(/^In your own words/);
    expect(card.back).toBe("Y");
    expect(card.cloze_text).toBeNull();
  });
});
