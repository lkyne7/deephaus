import { describe, expect, it } from "vitest";
import { splitMathBlocks, texToSvg } from "../lib/math-svg";

describe("texToSvg", () => {
  it("renders a fraction as SVG sized in em with depth below the baseline", () => {
    const svg = texToSvg("\\frac{a}{b}");
    expect(svg).not.toBeNull();
    expect(svg!.xml.startsWith("<svg")).toBe(true);
    expect(svg!.xml).toContain("currentColor");
    const root = svg!.xml.slice(0, svg!.xml.indexOf(">") + 1);
    expect(root).not.toMatch(/ width=| height=| style=/);
    expect(svg!.width).toBeGreaterThan(0.5);
    expect(svg!.height).toBeGreaterThan(svg!.depth);
    expect(svg!.depth).toBeGreaterThan(0);
  });

  it("caches by formula and display mode", () => {
    expect(texToSvg("x^2")).toBe(texToSvg("x^2"));
    expect(texToSvg("x^2", true)).not.toBe(texToSvg("x^2", false));
  });
});

describe("splitMathBlocks", () => {
  it("lifts display formulas out of surrounding text", () => {
    expect(splitMathBlocks("Before\n$$\nE = mc^2\n$$\n\nAfter $x$")).toEqual([
      { type: "text", value: "Before\n" },
      { type: "math", formula: "E = mc^2" },
      { type: "text", value: "\n\nAfter $x$" },
    ]);
  });

  it("leaves text without display formulas alone", () => {
    expect(splitMathBlocks("Costs $5 and $x$")).toEqual([{ type: "text", value: "Costs $5 and $x$" }]);
  });
});
