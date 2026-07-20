import { readFile } from "node:fs/promises";
import {
  inspectPageSignals,
  type PageTextItem,
} from "@deephaus/pdf-extraction";
import { describe, expect, it } from "vitest";

type RouterFixture = {
  name: string;
  layout: "single" | "columns" | "table" | "empty";
  text: string;
  imageOps: number;
  vectorOps: number;
  expectedRoute: "local" | "ocr";
  expectedReason?: string;
};

function item(str: string, x: number, y: number): PageTextItem {
  return { str, transform: [12, 0, 0, 12, x, y], width: str.length * 6 };
}

function fixtureItems(fixture: RouterFixture): PageTextItem[] {
  if (fixture.layout === "empty") return [];
  if (fixture.layout === "columns") {
    return Array.from({ length: 10 }, (_, row) => [
      item(fixture.text, 45, 740 - row * 26),
      item(fixture.text, 340, 740 - row * 26),
    ]).flat();
  }
  if (fixture.layout === "table") {
    return Array.from({ length: 5 }, (_, row) => [
      item(`row ${row}`, 45, 740 - row * 26),
      item(`${row * 10}`, 210, 740 - row * 26),
      item(`${row * 20}`, 390, 740 - row * 26),
    ]).flat();
  }
  return Array.from({ length: 10 }, (_, row) =>
    item(fixture.text, 55, 740 - row * 26),
  );
}

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/router-signals.json", import.meta.url), "utf8"),
) as RouterFixture[];

describe("representative PDF router fixtures", () => {
  it.each(fixtures)("$name routes through $expectedRoute", (fixture) => {
    const result = inspectPageSignals({
      pageNumber: 1,
      width: 612,
      height: 792,
      items: fixtureItems(fixture),
      imageOps: fixture.imageOps,
      vectorOps: fixture.vectorOps,
    });
    expect(result.route).toBe(fixture.expectedRoute);
    if (fixture.expectedReason) {
      expect(result.reasons).toContain(fixture.expectedReason);
    }
  });
});
