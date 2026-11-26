import { describe, expect, it } from "vitest";
import { deckHref, parseDeckPaneView } from "@/lib/decks/deck-link";

describe("deckHref", () => {
  it("opens the deck's pane on the Decks page", () => {
    expect(deckHref("d1")).toBe("/decks?deck=d1");
  });

  it("names the pane view to open", () => {
    expect(deckHref("d1", "settings")).toBe("/decks?deck=d1&panel=settings");
    expect(deckHref("d1", null)).toBe("/decks?deck=d1");
  });
});

describe("parseDeckPaneView", () => {
  it("accepts the pane's views and nothing else", () => {
    expect(parseDeckPaneView("sharing")).toBe("sharing");
    expect(parseDeckPaneView("forecast")).toBe("forecast");
    expect(parseDeckPaneView("cards")).toBeNull();
    expect(parseDeckPaneView(undefined)).toBeNull();
  });
});
