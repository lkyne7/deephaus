import { describe, expect, it } from "vitest";
import { indexPlainText, locateQuote, prepareHaystack } from "@/components/source-card-links";

/**
 * Run the matcher over plain text (indexed the way buildDocText indexes a
 * text node) and resolve the ranges back to the original string.
 */
function highlighted(text: string, quote: string): string[] {
  const haystack = prepareHaystack(indexPlainText(text));
  return locateQuote(haystack, quote).map((r) => text.slice(r.from, r.to));
}

describe("locateQuote — exact path", () => {
  it("returns a single range when the quote appears verbatim", () => {
    const text = "Alpha bravo. The probe is placed below the xiphoid process. Charlie.";
    expect(highlighted(text, "The probe is placed below the xiphoid process.")).toEqual([
      "The probe is placed below the xiphoid process.",
    ]);
  });

  it("matches across typographic quotes and PDF hyphen wraps", () => {
    const text = "Prior to scanning, “Dive the Depth”: set the depth to maxi- mum.";
    expect(
      highlighted(text, 'Prior to scanning, "Dive the Depth": set the depth to maximum.'),
    ).toEqual(["Prior to scanning, “Dive the Depth”: set the depth to maxi- mum."]);
  });

  it("ignores quotes that are too short to be unambiguous", () => {
    expect(highlighted("the heart and the lungs", "the heart")).toEqual([]);
  });
});

describe("locateQuote — fragment path (two-column PDF interleaving)", () => {
  it("highlights both halves of a sentence split by a line from the other column", () => {
    // Real shape from a two-column PDF: the right-column line "Novices almost
    // always…" is spliced into the middle of the left-column sentence.
    const text =
      "come into view. The first thing you will notice will not be " +
      "Novices almost always equate the far field with the poste- " +
      "cardiac anatomy. It will be that there is a moving structure.";
    expect(
      highlighted(text, "The first thing you will notice will not be cardiac anatomy."),
    ).toEqual(["The first thing you will notice will not be", "cardiac anatomy."]);
  });

  it("does not highlight the interleaved foreign line", () => {
    const text =
      "by far the best approach is the subxiphoid " +
      "who will, it will be very useful to detect their effusions " +
      "view. The probe is placed below the xiphoid process.";
    const ranges = highlighted(text, "By far the best approach is the subxiphoid view.");
    expect(ranges).toEqual(["by far the best approach is the subxiphoid", "view."]);
    expect(ranges.join(" ")).not.toContain("effusions");
  });

  it("handles a quote interrupted twice", () => {
    const text =
      "Cardiac EDE is useful in two settings: " +
      "maximum. You will repeat this preparatory adjustment " +
      "cardiac arrest and patients in " +
      "sooner rather than later. Even if you are not concerned " +
      "whom you want to rule out pericardial tamponade.";
    expect(
      highlighted(
        text,
        "Cardiac EDE is useful in two settings: cardiac arrest and patients in whom you want to rule out pericardial tamponade.",
      ),
    ).toEqual([
      "Cardiac EDE is useful in two settings:",
      "cardiac arrest and patients in",
      "whom you want to rule out pericardial tamponade.",
    ]);
  });

  it("bridges a page break when the resume phrase is distinctive", () => {
    const filler = Array.from({ length: 180 }, (_, i) => `filler${i}`).join(" ");
    const text =
      "The giveaway is that it will appear anteriorly. Effusions " +
      `ESSENTIALS OF ULTRASOUND 35 Page 8 A Few Final Tips ${filler} ` +
      "appear posteriorly first (due to gravity) and never only anteriorly. Next.";
    expect(
      highlighted(
        text,
        "The giveaway is that it will appear anteriorly. Effusions appear posteriorly first (due to gravity) and never only anteriorly.",
      ),
    ).toEqual([
      "The giveaway is that it will appear anteriorly. Effusions",
      "appear posteriorly first (due to gravity) and never only anteriorly.",
    ]);
  });

  it("will not jump far for a generic resume phrase", () => {
    const filler = Array.from({ length: 180 }, (_, i) => `filler${i}`).join(" ");
    const text = `Alpha beta gamma delta epsilon starts here ${filler} and it was so.`;
    // Only the anchor half is present nearby; "and it was" is too generic to
    // justify a 180-word jump, so the tail stays unhighlighted and coverage
    // falls below the threshold.
    expect(highlighted(text, "Alpha beta gamma delta and it was so and more and more.")).toEqual(
      [],
    );
  });

  it("bridges a single paraphrased word rather than splitting the highlight", () => {
    const text =
      "The pericardium, being a tough fibrous structure, provides a clear boundary here.";
    expect(
      highlighted(
        text,
        "The pericardium, being a tough fibrous structure, provided a clear boundary here.",
      ),
    ).toEqual(["The pericardium, being a tough fibrous structure, provides a clear boundary here."]);
  });

  it("recovers a quote whose opening words were paraphrased by anchoring later", () => {
    const text = "Intro text. Cardiac standstill on EDE is a useful additional data point. Outro.";
    expect(
      highlighted(text, "Seeing cardiac standstill on EDE is a useful additional data point."),
    ).toEqual(["Cardiac standstill on EDE is a useful additional data point."]);
  });

  it("gives up when too little of the quote is present", () => {
    const text = "This document is about something else entirely, with no overlap at all.";
    expect(
      highlighted(
        text,
        "The curved array probe used for abdominal scans works well for cardiac EDE.",
      ),
    ).toEqual([]);
  });

  it("refuses to anchor on a short common phrase alone", () => {
    const text = "one of the reasons we do this is unrelated. of the things we saw, none matched.";
    expect(highlighted(text, "of the completely different sentence here now")).toEqual([]);
  });

  it("picks the anchor occurrence that recovers the most of the quote", () => {
    const text =
      "the probe is placed on the chest for lung views. " +
      "Later: the probe is placed below the xiphoid " +
      "unrelated column text here " +
      "process and aimed almost straight up.";
    expect(
      highlighted(
        text,
        "The probe is placed below the xiphoid process and aimed almost straight up.",
      ),
    ).toEqual(["the probe is placed below the xiphoid", "process and aimed almost straight up."]);
  });
});
