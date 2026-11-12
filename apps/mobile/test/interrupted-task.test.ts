import { describe, expect, it } from "vitest";
import { interruptedTaskMessage } from "@/lib/interrupted-task";

describe("interruptedTaskMessage", () => {
  it("asks for a topic, notes or link to be sent again, not for a file", () => {
    for (const title of [
      "Topic: Heart failure guidelines",
      "Generating cards",
      "YouTube import",
      "Website import",
    ]) {
      const message = interruptedTaskMessage({ kind: "generation", title });
      expect(message).toMatch(/Send it again/);
      expect(message).not.toMatch(/file/);
    }
  });

  it("asks for the file again for an upload", () => {
    expect(interruptedTaskMessage({ kind: "generation", title: "notes.pdf" })).toMatch(
      /Select the file/,
    );
    expect(interruptedTaskMessage({ kind: "anki-import", title: "deck.apkg" })).toMatch(
      /Select the file/,
    );
  });

  it("asks for an export to be started again", () => {
    expect(interruptedTaskMessage({ kind: "anki-export", title: "Psych" })).toMatch(
      /Start it again/,
    );
  });
});
