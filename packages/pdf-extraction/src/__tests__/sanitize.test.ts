import { describe, expect, it } from "vitest";
import { sanitizeForPostgres, stripNullBytes } from "../sanitize.js";

describe("stripNullBytes", () => {
  it("removes NUL characters from strings", () => {
    expect(stripNullBytes("hello\u0000world")).toBe("helloworld");
    expect(stripNullBytes("\u0000a\u0000b\u0000")).toBe("ab");
  });

  it("leaves other characters untouched", () => {
    expect(stripNullBytes("∡\u0001 math")).toBe("∡\u0001 math");
  });
});

describe("sanitizeForPostgres", () => {
  it("strips NULs from nested extraction payloads", () => {
    const input = {
      markdown: "Title\u0000",
      blocks: [
        { text: "a\u0000b", runs: [{ text: "c\u0000d" }] },
        { items: ["e\u0000", "f"] },
      ],
    };
    const sanitized = sanitizeForPostgres(input);
    expect(JSON.stringify(sanitized)).not.toContain("\\u0000");
    expect(sanitized).toEqual({
      markdown: "Title",
      blocks: [
        { text: "ab", runs: [{ text: "cd" }] },
        { items: ["e", "f"] },
      ],
    });
  });
});
