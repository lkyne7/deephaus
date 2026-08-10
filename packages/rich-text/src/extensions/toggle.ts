import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggleBlock: {
      /** Insert a collapsible toggle block at the selection. */
      insertToggle: () => ReturnType;
    };
  }
}

/**
 * Notion-style collapsible toggle, modeled after TipTap's (paid) Details trio:
 * toggle > toggleSummary + toggleContent. The open state is a document
 * attribute so it round-trips through JSON/HTML.
 */
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }, { tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle-summary",
        class: "dh-toggle__summary",
      }),
      0,
    ];
  },
});

export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle-content",
        class: "dh-toggle__content",
      }),
      0,
    ];
  },
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-open") !== "false",
        renderHTML: (attributes) => ({ "data-open": attributes.open ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }, { tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle", class: "dh-toggle" }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "dh-toggle";
      dom.setAttribute("data-type", "toggle");
      dom.setAttribute("data-open", node.attrs.open ? "true" : "false");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "dh-toggle__button";
      button.contentEditable = "false";
      button.title = node.attrs.open ? "Collapse" : "Expand";
      button.setAttribute("aria-label", node.attrs.open ? "Collapse toggle" : "Expand toggle");
      button.setAttribute("aria-expanded", node.attrs.open ? "true" : "false");
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "toggle") return;
        editor.view.dispatch(
          editor.state.tr
            .setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open })
            .setMeta("toggle", true),
        );
      });

      const content = document.createElement("div");
      content.className = "dh-toggle__body";

      dom.append(button, content);

      return {
        dom,
        contentDOM: content,
        update: (updated) => {
          if (updated.type.name !== "toggle") return false;
          dom.setAttribute("data-open", updated.attrs.open ? "true" : "false");
          button.title = updated.attrs.open ? "Collapse" : "Expand";
          button.setAttribute(
            "aria-label",
            updated.attrs.open ? "Collapse toggle" : "Expand toggle",
          );
          button.setAttribute("aria-expanded", updated.attrs.open ? "true" : "false");
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertToggle:
        () =>
        ({ chain, state }) => {
          const { $from, $to } = state.selection;
          const selectedText = state.doc.textBetween($from.pos, $to.pos, " ").trim();
          return chain()
            .insertContent({
              type: this.name,
              attrs: { open: true },
              content: [
                {
                  type: "toggleSummary",
                  content: selectedText ? [{ type: "text", text: selectedText }] : [],
                },
                { type: "toggleContent", content: [{ type: "paragraph" }] },
              ],
            })
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter inside the summary jumps into the toggle body (and opens it).
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "toggleSummary") return false;
        const togglePos = $from.before($from.depth - 1);
        const toggleNode = state.doc.nodeAt(togglePos);
        if (!toggleNode || toggleNode.type.name !== "toggle") return false;

        let tr = state.tr;
        if (!toggleNode.attrs.open) {
          tr = tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true });
        }
        // First position inside toggleContent's first block.
        const summary = toggleNode.child(0);
        const contentStart = togglePos + 1 + summary.nodeSize + 1;
        tr = tr.setSelection(TextSelection.create(tr.doc, contentStart + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      // Backspace at the start of an empty summary removes the toggle wrapper.
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (
          !empty ||
          $from.parent.type.name !== "toggleSummary" ||
          $from.parentOffset !== 0 ||
          $from.parent.content.size !== 0
        ) {
          return false;
        }
        const togglePos = $from.before($from.depth - 1);
        const toggleNode = state.doc.nodeAt(togglePos);
        if (!toggleNode || toggleNode.type.name !== "toggle") return false;

        // Replace the toggle with its body blocks.
        const content = toggleNode.child(1);
        const tr = state.tr.replaceWith(
          togglePos,
          togglePos + toggleNode.nodeSize,
          content.content,
        );
        tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
