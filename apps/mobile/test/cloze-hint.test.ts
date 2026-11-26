import { describe, expect, it } from "vitest";
import { clozeHint, setClozeHint } from "../lib/card-text-editing";

describe("cloze hints", () => {
  const text = "The {{c1::myelin sheath}} lets a signal jump between {{c2::nodes::gaps}} and {{c1::more}}.";

  it("reads a blank's hint", () => {
    expect(clozeHint(text, 2)).toBe("gaps");
    expect(clozeHint(text, 1)).toBeNull();
  });

  it("sets a hint on every deletion of one blank", () => {
    expect(setClozeHint(text, 1, "fatty")).toBe(
      "The {{c1::myelin sheath::fatty}} lets a signal jump between {{c2::nodes::gaps}} and {{c1::more::fatty}}.",
    );
  });

  it("removes a hint and drops characters that would break the syntax", () => {
    expect(setClozeHint(text, 2, null)).toContain("{{c2::nodes}}");
    expect(setClozeHint(text, 2, "a}}b::c")).toContain("{{c2::nodes::abc}}");
  });
});
