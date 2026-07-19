"use client";

import type { Editor } from "@tiptap/react";
import { RichTextBubbleToolbar } from "./rich-text-bubble-toolbar";

type Props = {
  editor: Editor | null;
  disabled?: boolean;
  clozeEnabled?: boolean;
  menuPluginKey?: string;
  onInsertImage?: () => void;
};

/** Card-field selection toolbar — same chrome as source/notes, without generate. */
export function FloatingEditorToolbar({
  editor,
  disabled,
  clozeEnabled = false,
  menuPluginKey = "formatToolbar",
  onInsertImage,
}: Props) {
  if (!editor) return null;
  return (
    <RichTextBubbleToolbar
      editor={editor}
      disabled={disabled}
      headingLevels={[]}
      showCode
      showBlockquote
      clozeEnabled={clozeEnabled}
      onInsertImage={onInsertImage}
      menuPluginKey={menuPluginKey}
    />
  );
}
