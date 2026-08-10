import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a callout (or insert an empty one). */
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      /** Lift callout content back into the document. */
      unsetCallout: () => ReturnType;
      toggleCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

export const CALLOUT_EMOJIS = ["💡", "⚠️", "❗", "✅", "❓", "📌", "🔥", "📝"];

const DEFAULT_EMOJI = CALLOUT_EMOJIS[0]!;

/**
 * Notion-style callout: an emoji badge beside a tinted container of blocks.
 * Clicking the emoji cycles through presets.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: DEFAULT_EMOJI,
        parseHTML: (element) => element.getAttribute("data-emoji") || DEFAULT_EMOJI,
        renderHTML: (attributes) => ({ "data-emoji": String(attributes.emoji ?? DEFAULT_EMOJI) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]', contentElement: ".dh-callout__content" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "dh-callout" }),
      ["span", { class: "dh-callout__emoji", contenteditable: "false" }, String(node.attrs.emoji ?? DEFAULT_EMOJI)],
      ["div", { class: "dh-callout__content" }, 0],
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "dh-callout";
      dom.setAttribute("data-type", "callout");
      dom.setAttribute("data-emoji", String(node.attrs.emoji ?? DEFAULT_EMOJI));

      const emojiButton = document.createElement("button");
      emojiButton.type = "button";
      emojiButton.className = "dh-callout__emoji";
      emojiButton.contentEditable = "false";
      emojiButton.title = "Change icon";
      emojiButton.textContent = String(node.attrs.emoji ?? DEFAULT_EMOJI);
      emojiButton.addEventListener("mousedown", (event) => event.preventDefault());
      emojiButton.addEventListener("click", () => {
        if (!editor.isEditable || typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "callout") return;
        const index = CALLOUT_EMOJIS.indexOf(String(current.attrs.emoji));
        const next = CALLOUT_EMOJIS[(index + 1) % CALLOUT_EMOJIS.length];
        editor.view.dispatch(
          editor.state.tr
            .setNodeMarkup(pos, undefined, { ...current.attrs, emoji: next })
            .setMeta("callout", true),
        );
      });

      const content = document.createElement("div");
      content.className = "dh-callout__content";

      dom.append(emojiButton, content);

      return {
        dom,
        contentDOM: content,
        update: (updated) => {
          if (updated.type.name !== "callout") return false;
          const emoji = String(updated.attrs.emoji ?? DEFAULT_EMOJI);
          emojiButton.textContent = emoji;
          dom.setAttribute("data-emoji", emoji);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { emoji: attrs?.emoji ?? DEFAULT_EMOJI }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
      toggleCallout:
        (attrs) =>
        ({ commands, editor }) =>
          editor.isActive(this.name)
            ? commands.lift(this.name)
            : commands.wrapIn(this.name, { emoji: attrs?.emoji ?? DEFAULT_EMOJI }),
    };
  },
});
