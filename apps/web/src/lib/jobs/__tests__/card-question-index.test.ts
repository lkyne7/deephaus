import { describe, expect, it } from "vitest";
import { CardQuestionIndex } from "@deephaus/shared";

const basic = (front: string, back: string) => ({ type: "basic", front, back });

function indexOf(...cards: Array<ReturnType<typeof basic>>) {
  const index = new CardQuestionIndex();
  for (const card of cards) index.add(card);
  return index;
}

describe("CardQuestionIndex", () => {
  // Pairs a real re-run produced from the same source.
  it.each([
    [
      "What does the stomach secrete to help digest protein?",
      "What does the stomach secrete for protein digestion?",
      "Hydrochloric acid and pepsinogen.",
    ],
    [
      "Where does ADH increase water reabsorption?",
      "Where does antidiuretic hormone increase water reabsorption?",
      "In the **collecting duct** of the nephron.",
    ],
    [
      "What does antidiuretic hormone (ADH) do in the nephron?",
      "What does antidiuretic hormone do in the nephron?",
      "Raises water reabsorption in the collecting duct.",
    ],
    [
      "What structures increase the small intestine's surface area for absorption?",
      "What structures increase the small intestine’s surface area for nutrient absorption?",
      "Villi and microvilli.",
    ],
    ["What does the pancreas release?", "What does the pancreas release into the duodenum?", "Enzymes."],
  ])("treats a rewording as a repeat: %s", (first, second, answer) => {
    expect(indexOf(basic(first, answer)).has(basic(second, answer))).toBe(true);
  });

  it("ignores formatting differences in answers", () => {
    const index = indexOf(basic("What does the large intestine do?", "**Reabsorbs water.**"));
    expect(index.has(basic("What does the large intestine do with water?", "reabsorbs water"))).toBe(
      true,
    );
  });

  it.each([
    ["What does pepsin activate?", "Pepsinogen.", "What activates pepsinogen?", "Pepsin."],
    ["What happens in prophase?", "Chromosomes condense.", "What happens in metaphase?", "They align."],
    ["What does the liver produce?", "Bile.", "What does the liver process?", "Absorbed nutrients."],
    ["What is the capital of France?", "Paris", "Which city hosts the Louvre?", "Paris"],
    [
      "What does the left ventricle pump to?",
      "The body.",
      "What does the right ventricle pump to?",
      "The lungs.",
    ],
  ])("keeps different questions: %s / %s", (first, firstAnswer, second, secondAnswer) => {
    expect(indexOf(basic(first, firstAnswer)).has(basic(second, secondAnswer))).toBe(false);
  });

  it("compares fill-in-the-blank cards by their sentence", () => {
    const index = new CardQuestionIndex();
    index.add({ type: "cloze", cloze_text: "The {{c1::hippocampus}} binds episodic memories." });
    expect(
      index.has({ type: "cloze", clozeText: "The hippocampus binds {{c1::episodic memories}}." }),
    ).toBe(true);
    expect(
      index.has({ type: "cloze", clozeText: "The {{c1::amygdala}} processes fear responses." }),
    ).toBe(false);
  });
});
