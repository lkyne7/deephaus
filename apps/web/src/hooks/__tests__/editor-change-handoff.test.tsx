// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const editor = vi.hoisted(() => ({ options: null as any }));
vi.mock("@tiptap/react", () => ({
  useEditor: (options: any) => {
    editor.options = options;
    return null;
  },
  EditorContent: () => null,
}));
vi.mock("@deephaus/rich-text", () => ({
  normalizeEditorValue: () => ({ markdown: "original", json: { type: "doc" } }),
  getCardEditorExtensions: () => [],
  richTextEditorKeydownProps: () => ({}),
  buildCardRichTextContent: () => ({
    markdown: "latest edit",
    json: { type: "doc" },
  }),
}));
vi.mock("@/components/image-crop-dialog", () => ({
  ImageCropDialog: () => null,
}));
vi.mock("@/components/rich-text/floating-editor-toolbar", () => ({
  FloatingEditorToolbar: () => null,
}));
vi.mock("@/components/rich-text/link-hover-editor", () => ({
  LinkHoverEditor: () => null,
}));
import { InlineCardEditor } from "@/components/rich-text/inline-card-editor";
it("hands the latest edit to draft persistence before a card is closed", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  const onChange = vi.fn();
  await act(async () => {
    root.render(
      <InlineCardEditor
        value="original"
        ariaLabel="Front"
        onChange={onChange}
      />,
    );
  });
  try {
    act(() => {
      editor.options.onUpdate({ editor: { getJSON: () => ({ type: "doc" }) } });
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: "latest edit" }),
    );
    expect(editor.options.editorProps.attributes["aria-label"]).toBe("Front");
  } finally {
    await act(async () => root.unmount());
  }
});
