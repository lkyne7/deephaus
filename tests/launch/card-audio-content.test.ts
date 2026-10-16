import { describe, expect, it } from "vitest";
import {
  cardAudioSnippet,
  cardTextForSpeech,
  extractAllCardMediaUrls,
  extractCardAudioUrls,
  extractCardMediaUrls,
  parseCardContent,
  rewriteCardMediaForAnki,
  stripCardMedia,
} from "../../packages/shared/src/card-content";
import { requiredCardMedia } from "../../packages/shared/src/offline-media";
import { cardAudioSizeError, MAX_CARD_AUDIO_BYTES } from "../../packages/shared/src/schemas";

const AUDIO = "https://cdn.test/storage/v1/object/public/card-media/u/c/1-clip.m4a";
const IMAGE = "https://cdn.test/storage/v1/object/public/card-media/u/c/2-pic.png";

describe("audio clips in card content", () => {
  it("parses <audio> tags into audio segments, with and without a closing tag", () => {
    const text = `Listen:\n\n<audio src="${AUDIO}" title="Heart murmur"></audio>\n\nThen <audio src="${AUDIO}"> and ![pic](${IMAGE})`;
    const segments = parseCardContent(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "audio", "text", "audio", "text", "image"]);
    expect(segments[1]).toEqual({ type: "audio", src: AUDIO, title: "Heart murmur" });
    expect(segments[3]).toEqual({ type: "audio", src: AUDIO, title: "Audio" });
    // The closing tag is consumed, so no stray "</audio>" text is left over.
    expect(segments.filter((s) => s.type === "text").map((s) => s.type === "text" && s.value)).not.toContain("</audio>");
  });

  it("drops audio with a non-http source", () => {
    expect(parseCardContent('<audio src="file:///tmp/x.mp3"></audio>')).toEqual([]);
    expect(parseCardContent('<audio src="data:audio/mpeg;base64,AAAA"></audio>')).toEqual([]);
  });

  it("builds a snippet the parser reads back, escaping the title", () => {
    const snippet = cardAudioSnippet(AUDIO, 'S1 "lub" & dub');
    expect(snippet.startsWith("\n\n<audio src=")).toBe(true);
    expect(parseCardContent(snippet)).toEqual([
      { type: "text", value: "\n\n" },
      { type: "audio", src: AUDIO, title: 'S1 "lub" & dub' },
    ]);
    expect(cardAudioSnippet(AUDIO)).toBe(`\n\n<audio src="${AUDIO}"></audio>`);
  });

  it("separates image and audio URLs, and offline media needs both", () => {
    const front = `Q <audio src="${AUDIO}"></audio> ![p](${IMAGE})`;
    expect(extractCardMediaUrls(front)).toEqual([IMAGE]);
    expect(extractCardAudioUrls(front)).toEqual([AUDIO]);
    expect(extractAllCardMediaUrls(front, front)).toEqual([AUDIO, IMAGE]);
    expect(requiredCardMedia({ front, back: null, cloze_text: null, extra: null, occlusion_data: null })).toEqual([AUDIO, IMAGE]);
  });

  it("summarises clips as [audio] in previews", () => {
    expect(stripCardMedia(`Say it <audio src="${AUDIO}" title="x"></audio> now`)).toBe("Say it [audio] now");
  });

  it("rewrites clips to Anki [sound:] tags on export and drops unmapped ones", () => {
    const text = `Word <audio src="${AUDIO}" title="x"></audio> ![p](${IMAGE}) <audio src="https://cdn.test/missing.mp3"></audio>`;
    const out = rewriteCardMediaForAnki(text, new Map([[AUDIO, "deephaus-0001.m4a"], [IMAGE, "deephaus-0002.png"]]));
    expect(out).toBe('Word [sound:deephaus-0001.m4a] <img src="deephaus-0002.png" alt="p">');
  });

  it("reduces a field to the words a voice should read", () => {
    const text = `## Heart sounds\n\nThe **S1** sound is {{c1::closure::hint}} of the <u>mitral</u> valve. ![p](${IMAGE})\n\n<audio src="${AUDIO}"></audio>\n- item one\n- *item two*\n\nSee [the guide](https://x.test) &amp; $E=mc^2$`;
    expect(cardTextForSpeech(text)).toBe(
      "Heart sounds\nThe S1 sound is closure of the mitral valve.\nitem one\nitem two\nSee the guide & $E=mc^2$",
    );
    expect(cardTextForSpeech(null)).toBe("");
  });

  it("keeps audio uploads under the 4.5 MB function body cap", () => {
    expect(MAX_CARD_AUDIO_BYTES).toBeLessThan(4.5 * 1000 * 1000 - 64 * 1024);
    expect(cardAudioSizeError(MAX_CARD_AUDIO_BYTES)).toBeNull();
    expect(cardAudioSizeError(MAX_CARD_AUDIO_BYTES + 1)).toMatch(/up to 4 MB \(this one is 4\.0 MB\)/);
  });
});
