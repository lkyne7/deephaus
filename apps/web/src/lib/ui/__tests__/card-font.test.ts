import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_FONT_STORAGE_KEY, cardFontInitScript, isCardFont } from "@/lib/ui/card-font";

function runInitScript(stored: string | null) {
  const setProperty = vi.fn();
  const appended: Array<{ id: string; href: string }> = [];
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === CARD_FONT_STORAGE_KEY ? stored : null) });
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty } },
    createElement: () => ({ id: "", rel: "", href: "" }),
    head: { appendChild: (link: { id: string; href: string }) => appended.push(link) },
  });
  new Function(cardFontInitScript)();
  return { setProperty, appended };
}

afterEach(() => vi.unstubAllGlobals());

describe("card font", () => {
  it("accepts only known fonts", () => {
    expect(isCardFont("dyslexia")).toBe(true);
    expect(isCardFont("comic-sans")).toBe(false);
    expect(isCardFont(null)).toBe(false);
  });

  it("leaves the serif default alone before paint", () => {
    expect(runInitScript(null).setProperty).not.toHaveBeenCalled();
    expect(runInitScript("serif").setProperty).not.toHaveBeenCalled();
    expect(runInitScript("bogus").setProperty).not.toHaveBeenCalled();
  });

  it("applies a stored font without loading the dyslexia font", () => {
    const { setProperty, appended } = runInitScript("sans");
    expect(setProperty).toHaveBeenCalledWith("--font-card", "var(--font-sans)");
    expect(appended).toEqual([]);
  });

  it("loads Atkinson Hyperlegible only when it is chosen", () => {
    const { setProperty, appended } = runInitScript("dyslexia");
    expect(setProperty).toHaveBeenCalledWith("--font-card", '"Atkinson Hyperlegible", var(--font-sans)');
    expect(appended[0]?.href).toContain("family=Atkinson+Hyperlegible");
  });
});
