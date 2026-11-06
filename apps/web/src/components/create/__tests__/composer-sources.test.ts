import { describe, expect, it } from "vitest";
import { suggestDeckName } from "@/components/create/composer-sources";
import { titleFromText } from "@/lib/sources/text-title";

describe("titleFromText", () => {
  it("uses a whole first sentence when it fits", () => {
    expect(
      titleFromText("Photosynthesis converts light energy into chemical energy. In the light"),
    ).toBe("Photosynthesis converts light energy into chemical energy");
  });

  it("cuts long text at a word boundary without stray punctuation", () => {
    const title = titleFromText(
      "Cyclic electron flow, which uses only photosystem one, makes ATP without any NADPH at all",
      44,
    );
    expect(title).toBe("Cyclic electron flow, which uses only…");
  });

  it("doesn't treat a short abbreviation as a sentence", () => {
    expect(titleFromText("Dr. Smith on memory", 60)).toBe("Dr. Smith on memory");
  });

  it("only reads the first line", () => {
    expect(titleFromText("Chapter 4\nEncoding and retrieval")).toBe("Chapter 4");
  });
});

describe("suggestDeckName", () => {
  it("names a deck after the message when there are no sources", () => {
    expect(suggestDeckName([], "The light reactions of photosynthesis")).toBe(
      "The light reactions of photosynthesis",
    );
  });

  it("names a deck after pasted text", () => {
    expect(
      suggestDeckName(
        [{ id: "a", kind: "text", text: "Memory has three stages. Encoding comes first." }],
        "Focus on encoding",
      ),
    ).toBe("Memory has three stages");
  });
});
