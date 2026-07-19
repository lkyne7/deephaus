import type { Editor } from "@tiptap/core";

/** Preset text colors shared by the bubble toolbar and ⌘⇧H shortcut. */
export const TEXT_COLORS: ReadonlyArray<{ key: string; label: string; value: string | null }> = [
  { key: "default", label: "Default", value: null },
  { key: "gray", label: "Gray", value: "#9B9A97" },
  { key: "brown", label: "Brown", value: "#64473A" },
  { key: "orange", label: "Orange", value: "#D9730D" },
  { key: "yellow", label: "Yellow", value: "#DFAB01" },
  { key: "green", label: "Green", value: "#0F7B6C" },
  { key: "blue", label: "Blue", value: "#0B6E99" },
  { key: "purple", label: "Purple", value: "#6940A5" },
  { key: "pink", label: "Pink", value: "#AD1A72" },
  { key: "red", label: "Red", value: "#E03E3E" },
];

let lastTextColor: string | null = null;

export function setLastTextColor(color: string | null): void {
  lastTextColor = color;
}

export function getLastTextColor(): string | null {
  return lastTextColor;
}

export function applyTextColor(editor: Editor, color: string | null): boolean {
  lastTextColor = color;
  const c = editor.chain().focus();
  return color ? c.setColor(color).run() : c.unsetColor().run();
}

/** ⌘⇧H — reapply the most recently used text color (Notion behavior). */
export function applyLastTextColor(editor: Editor): boolean {
  return applyTextColor(editor, lastTextColor);
}
