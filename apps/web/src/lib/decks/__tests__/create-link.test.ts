import { describe, expect, it } from "vitest";
import { deckCreateHref, parseCreateParams } from "@/lib/decks/create-link";

describe("deckCreateHref", () => {
  it("links to the deck alone by default", () => {
    expect(deckCreateHref("d1")).toBe("/create?deck=d1");
    expect(deckCreateHref("d1", { prompt: "   " })).toBe("/create?deck=d1");
  });

  it("carries typed text and the choices it is given", () => {
    const href = deckCreateHref("d1", { prompt: "more on ATP & NADPH", detail: "high", focus: "exam", intent: "generate" });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("prompt")).toBe("more on ATP & NADPH");
    expect(params.get("detail")).toBe("high");
    expect(params.get("focus")).toBe("exam");
    expect(params.get("intent")).toBe("generate");
  });
});

describe("parseCreateParams", () => {
  it("keeps valid values and drops the rest", () => {
    expect(parseCreateParams({ detail: "low", focus: "exam", intent: "edit" })).toEqual({
      detail: "low",
      focus: "exam",
      intent: "edit",
    });
    expect(parseCreateParams({ detail: "huge", focus: "nope", intent: "x" })).toEqual({
      detail: undefined,
      focus: undefined,
      intent: undefined,
    });
  });
});
