import { describe, expect, it } from "vitest";
import { searchActions } from "@/lib/search/actions";

const ids = (query: string) => searchActions(query).map((action) => action.id);

describe("searchActions", () => {
  it("offers the shortcuts without a query", () => {
    expect(ids("  ")).toEqual(["new-deck", "study-settings", "insights", "import", "billing"]);
  });

  it("puts making cards first and encodes the topic", () => {
    const [first] = searchActions(" rock & roll ");
    expect(first.label).toBe("Make cards about “rock & roll”");
    expect(first.href).toBe("/create?prompt=rock%20%26%20roll");
  });

  it("keeps the actions that match the query", () => {
    expect(ids("insi")).toEqual(["make-cards", "insights"]);
    expect(ids("settings")).toEqual(["make-cards", "study-settings"]);
  });

  it("falls back to study settings when nothing matches", () => {
    expect(ids("kidney")).toEqual(["make-cards", "study-settings"]);
  });
});
