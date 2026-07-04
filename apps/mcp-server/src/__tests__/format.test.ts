import type { ReviewCardPayload } from "@deephaus/api-client";
import { describe, expect, it } from "vitest";
import { presentQueueCard, stripHtml } from "../format.js";

const intervals = {
  again: "5m",
  hard: "10m",
  good: "1d",
  easy: "4d",
};

function card(overrides: Partial<ReviewCardPayload>): ReviewCardPayload {
  return {
    id: "card-1",
    queue_key: "card-1:0",
    cloze_ord: null,
    type: "basic",
    front: "<p>Question</p>",
    back: "<strong>Answer</strong>",
    cloze_text: null,
    extra: "<em>Extra context</em>",
    tags: ["Biology"],
    state: 0,
    due: "2026-07-04T10:00:00.000Z",
    reps: 0,
    lapses: 0,
    is_new: true,
    intervals,
    ...overrides,
  };
}

describe("stripHtml", () => {
  it("collapses HTML markup and whitespace for MCP payloads", () => {
    expect(stripHtml("<p>Alpha&nbsp;</p><p>Beta</p>")).toBe("Alpha&nbsp; Beta");
  });
});

describe("presentQueueCard", () => {
  it("omits basic card answers unless explicitly requested", () => {
    const questionOnly = presentQueueCard(card({}), false);

    expect(questionOnly).toMatchObject({
      id: "card-1",
      type: "basic",
      front: "Question",
    });
    expect(questionOnly).not.toHaveProperty("back");
    expect(questionOnly).not.toHaveProperty("extra");
  });

  it("includes basic card answers when requested", () => {
    expect(presentQueueCard(card({}), true)).toMatchObject({
      front: "Question",
      back: "Answer",
      extra: "Extra context",
    });
  });

  it("masks cloze answers and hints in question-only mode", () => {
    const formatted = presentQueueCard(
      card({
        cloze_ord: 1,
        type: "cloze",
        cloze_text: "<p>The powerhouse is {{c1::mitochondria::organelle}} and {{c2::ATP}}.</p>",
      }),
      false,
    );

    expect(formatted).toMatchObject({
      type: "cloze",
      cloze_text: "The powerhouse is {{c1::...}} and {{c2::...}}.",
    });
    expect(formatted).not.toHaveProperty("extra");
  });

  it("preserves cloze answers when requested", () => {
    const formatted = presentQueueCard(
      card({
        cloze_ord: 1,
        type: "cloze",
        cloze_text: "<p>The powerhouse is {{c1::mitochondria::organelle}}.</p>",
      }),
      true,
    );

    expect(formatted).toMatchObject({
      cloze_text: "The powerhouse is {{c1::mitochondria::organelle}}.",
      extra: "Extra context",
    });
  });

  it("omits image occlusion data until answers are requested", () => {
    const occlusion = card({
      type: "image-occlusion",
      occlusion_data: { shapes: [{ id: "shape-1", answer: "hidden label" }] },
    });

    expect(presentQueueCard(occlusion, false)).not.toHaveProperty("occlusion_data");
    expect(presentQueueCard(occlusion, true)).toHaveProperty("occlusion_data", occlusion.occlusion_data);
  });
});
