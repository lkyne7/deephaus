import { describe, expect, it } from "vitest";
import { sanitizeEditedCard, type EditableCard, type EditedCardPatch } from "@deephaus/llm";

function basic(overrides: Partial<EditableCard> = {}): EditableCard {
  return {
    id: "card-1",
    type: "basic",
    front: "What is spontaneous nystagmus?",
    back: "Nystagmus seen with the patient at rest and looking straight ahead.",
    cloze_text: null,
    extra: null,
    tags: ["Vertigo"],
    ...overrides,
  };
}

function cloze(overrides: Partial<EditableCard> = {}): EditableCard {
  return {
    id: "card-2",
    type: "cloze",
    front: null,
    back: null,
    cloze_text: "The Dix-Hallpike test diagnoses {{c1::posterior canal BPPV}}.",
    extra: "Provoked by head positioning.",
    tags: [],
    ...overrides,
  };
}

function patch(id: string, overrides: Partial<EditedCardPatch> = {}): EditedCardPatch {
  return { id, front: null, back: null, cloze_text: null, extra: null, tags: null, ...overrides };
}

describe("sanitizeEditedCard", () => {
  it("ignores patches for a different card id", () => {
    expect(sanitizeEditedCard(basic(), patch("other", { back: "Paris." }))).toBeNull();
  });

  it("returns null when nothing changed (whitespace-insensitive)", () => {
    const card = basic();
    expect(
      sanitizeEditedCard(card, patch(card.id, { front: `  ${card.front}  `, back: card.back, tags: card.tags })),
    ).toBeNull();
  });

  it("returns only changed basic fields", () => {
    const card = basic();
    expect(sanitizeEditedCard(card, patch(card.id, { front: card.front, back: "At rest, primary gaze." }))).toEqual({
      back: "At rest, primary gaze.",
    });
  });

  it("rejects emptying a basic card's prompt or answer", () => {
    const card = basic();
    expect(sanitizeEditedCard(card, patch(card.id, { front: "   " }))).toBeNull();
    expect(sanitizeEditedCard(card, patch(card.id, { back: "" }))).toBeNull();
  });

  it("normalizes and dedupes tags, dropping location-style tags", () => {
    const card = basic();
    expect(
      sanitizeEditedCard(card, patch(card.id, { tags: ["Vertigo", " vertigo", "Neurology", "Page 3"] })),
    ).toEqual({ tags: ["Vertigo", "Neurology"] });
  });

  it("keeps existing hierarchical tags verbatim while normalizing new ones", () => {
    const card = basic({ tags: ["Gastrointestinal::Cholangitis", "PDF::Page1"] });
    expect(
      sanitizeEditedCard(
        card,
        patch(card.id, { tags: ["Gastrointestinal::Cholangitis", "PDF::Page1", "GI", "Hepatobiliary::Biliary tree"] }),
      ),
    ).toEqual({ tags: ["Gastrointestinal::Cholangitis", "PDF::Page1", "GI", "Hepatobiliary", "Biliary tree"] });
  });

  it("keeps cloze cards that retain a deletion and fixes single-colon typos", () => {
    const card = cloze();
    expect(
      sanitizeEditedCard(card, patch(card.id, { cloze_text: "Dix-Hallpike diagnoses {{c1:posterior canal BPPV}}." })),
    ).toEqual({ cloze_text: "Dix-Hallpike diagnoses {{c1::posterior canal BPPV}}." });
  });

  it("rejects cloze edits that remove every deletion", () => {
    const card = cloze();
    expect(
      sanitizeEditedCard(card, patch(card.id, { cloze_text: "Dix-Hallpike diagnoses posterior canal BPPV." })),
    ).toBeNull();
  });

  it("lets an explicit empty string clear a cloze extra, but null leaves it alone", () => {
    const card = cloze();
    expect(sanitizeEditedCard(card, patch(card.id, { extra: "" }))).toEqual({ extra: null });
    expect(sanitizeEditedCard(card, patch(card.id, { extra: null }))).toBeNull();
  });

  it("only allows front/tags on image-occlusion cards", () => {
    const card: EditableCard = { ...basic({ id: "io" }), type: "image-occlusion", back: "" };
    expect(
      sanitizeEditedCard(card, patch(card.id, { front: "Label the cranial nerves", back: "ignored", cloze_text: "{{c1::x}}" })),
    ).toEqual({ front: "Label the cranial nerves" });
  });
});
