import { parseCardContent } from "@deephaus/shared";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  getCardEditorExtensions,
  markdownToRichText,
  richTextToHtml,
  richTextToMarkdown,
  sanitizeCardHtml,
} from "../index.js";

const SRC = "https://cdn.example.com/card-media/u/c/1-clip.m4a";

describe("AudioClip", () => {
  it("round-trips card text through the editor document", () => {
    const content = markdownToRichText(`Say it\n\n<audio src="${SRC}" title="Heart murmur"></audio>\n\nThen grade`);
    const nodes = content.json.content?.map((node) => node.type);
    expect(nodes).toEqual(["paragraph", "audioClip", "paragraph"]);
    expect(content.json.content?.[1]?.attrs).toEqual({ src: SRC, title: "Heart murmur" });

    const markdown = richTextToMarkdown(content.json);
    expect(markdown).toContain(`<audio src="${SRC}" title="Heart murmur"></audio>`);
    // The shared parser reads the serialized form back as an audio segment.
    expect(parseCardContent(markdown).filter((segment) => segment.type === "audio")).toEqual([
      { type: "audio", src: SRC, title: "Heart murmur" },
    ]);
  });

  it("renders a playable, sanitized element and strips unsafe sources", () => {
    const json = { type: "doc", content: [{ type: "audioClip", attrs: { src: SRC, title: "x" } }] };
    const html = richTextToHtml(json);
    expect(html).toContain("<audio");
    expect(html).toContain(`src="${SRC}"`);
    expect(html).toContain("controls");
    expect(sanitizeCardHtml('<audio src="data:audio/mpeg;base64,AAAA" onplay="alert(1)"></audio>')).toBe("<audio></audio>");
  });

  it("shows a player in the editor and inserts through a command", () => {
    const editor = new Editor({ extensions: getCardEditorExtensions(), content: "<p>Word</p>" });
    editor.commands.setAudioClip({ src: SRC, title: "Pronunciation" });
    const player = editor.view.dom.querySelector<HTMLElement>("[data-audio-clip]");
    expect(player).not.toBeNull();
    expect(player?.querySelector("audio")?.getAttribute("src")).toBe(SRC);
    expect(player?.querySelector(".dh-audio-clip__title")?.textContent).toBe("Pronunciation");
    expect(richTextToMarkdown(editor.getJSON())).toContain(`<audio src="${SRC}" title="Pronunciation"></audio>`);
    editor.destroy();
  });
});
