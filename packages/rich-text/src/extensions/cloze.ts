import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { clozeClassName, MAX_CLOZE_ID } from "./cloze-colors.js";
import { createApplyClozeCommand, getClozeHintInRange, removeClozeInRange } from "./cloze-range.js";

export type ClozeAttrs = {
  id: string;
  hint?: string | null;
};

const CLOZE_REGEX = /^\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}$/;

export function clozeToMarkdown(text: string, id: string, hint?: string | null): string {
  if (hint) return `{{${id}::${text}::${hint}}}`;
  return `{{${id}::${text}}}`;
}

export function parseClozeMarkdown(raw: string): (ClozeAttrs & { text: string }) | null {
  const match = CLOZE_REGEX.exec(raw.trim());
  if (!match) return null;
  return {
    id: `c${match[1]}`,
    text: match[2],
    hint: match[3] ?? null,
  };
}

export function nextClozeId(editor: Editor): string {
  let max = 0;
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "cloze") continue;
      const n = Number.parseInt(String(mark.attrs.id).replace(/^c/i, ""), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  });
  return `c${Math.min(max + 1, MAX_CLOZE_ID)}`;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cloze: {
      toggleCloze: (attrs?: Partial<ClozeAttrs>) => ReturnType;
      addClozeNew: () => ReturnType;
      addClozeSame: () => ReturnType;
      applyCloze: (id: string) => ReturnType;
      setClozeId: (id: string) => ReturnType;
      updateCloze: (attrs: Partial<ClozeAttrs>) => ReturnType;
      removeCloze: () => ReturnType;
    };
  }

  interface Storage {
    cloze: {
      lastClozeId: string;
    };
  }
}

export const ClozeMark = Mark.create({
  name: "cloze",
  inclusive: false,
  excludes: "_",

  addOptions() {
    return {
      enabled: true,
    };
  },

  addStorage() {
    return {
      lastClozeId: "c1",
    };
  },

  addAttributes() {
    return {
      id: {
        default: "c1",
        parseHTML: (element) => element.getAttribute("data-cloze-id") ?? "c1",
        renderHTML: (attributes) => ({ "data-cloze-id": attributes.id }),
      },
      hint: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-cloze-hint") || null,
        renderHTML: (attributes) =>
          attributes.hint ? { "data-cloze-hint": attributes.hint } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-cloze-id]" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const id = String(mark.attrs.id ?? "c1");
    const hint = mark.attrs.hint ? { "data-cloze-hint": mark.attrs.hint } : {};
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: clozeClassName(id),
        "data-cloze-id": id,
        ...hint,
      }),
      0,
    ];
  },

  addCommands() {
    const rememberClozeId = (id: string) => {
      this.storage.lastClozeId = id;
    };

    return {
      toggleCloze:
        (attrs) =>
        ({ editor, commands, chain }) => {
          if (!this.options.enabled) return false;

          if (editor.isActive("cloze")) {
            return commands.removeCloze();
          }

          const { from, to, empty } = editor.state.selection;
          if (empty) return false;

          const id = attrs?.id ?? nextClozeId(editor);
          rememberClozeId(id);
          return chain()
            .command(createApplyClozeCommand(from, to, { id, hint: attrs?.hint ?? null }))
            .setTextSelection({ from, to })
            .run();
        },
      addClozeNew:
        () =>
        ({ editor, chain }) => {
          if (!this.options.enabled) return false;

          const { from, to, empty } = editor.state.selection;
          if (empty) return false;

          const id = nextClozeId(editor);
          rememberClozeId(id);
          return chain()
            .command(createApplyClozeCommand(from, to, { id, hint: null }))
            .setTextSelection({ from, to })
            .run();
        },
      addClozeSame:
        () =>
        ({ editor, chain }) => {
          if (!this.options.enabled) return false;

          const { from, to, empty } = editor.state.selection;
          if (empty) return false;

          const id = this.storage.lastClozeId ?? "c1";
          rememberClozeId(id);
          return chain()
            .command(createApplyClozeCommand(from, to, { id }))
            .setTextSelection({ from, to })
            .run();
        },
      applyCloze:
        (id) =>
        ({ editor, chain }) => {
          if (!this.options.enabled) return false;

          const { from, to, empty } = editor.state.selection;
          if (empty) return false;

          rememberClozeId(id);
          return chain()
            .command(createApplyClozeCommand(from, to, { id }))
            .setTextSelection({ from, to })
            .run();
        },
      setClozeId:
        (id) =>
        ({ commands }) => {
          if (!this.options.enabled) return false;
          return commands.updateCloze({ id });
        },
      updateCloze:
        (attrs) =>
        ({ editor, chain }) => {
          if (!this.options.enabled) return false;

          return chain()
            .focus()
            .extendMarkRange("cloze")
            .command(({ tr, state }) => {
              const { from, to } = state.selection;
              if (from === to) return false;

              const clozeType = state.schema.marks.cloze;
              if (!clozeType) return false;

              const current = editor.getAttributes("cloze");
              const id = attrs.id ?? current.id ?? "c1";
              const hint =
                attrs.hint !== undefined
                  ? attrs.hint
                  : (getClozeHintInRange(state, from, to) ?? current.hint ?? null);

              rememberClozeId(String(id));
              removeClozeInRange(tr, from, to);
              tr.addMark(from, to, clozeType.create({ id, hint: hint ?? null }));
              return true;
            })
            .run();
        },
      removeCloze:
        () =>
        ({ chain }) => {
          if (!this.options.enabled) return false;
          return chain().focus().extendMarkRange("cloze").unsetMark("cloze").run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => {
        if (!this.options.enabled) return false;
        return this.editor.commands.addClozeNew();
      },
      "Mod-Alt-Shift-c": () => {
        if (!this.options.enabled) return false;
        return this.editor.commands.addClozeSame();
      },
    };
  },
});

export { CLOZE_IDS } from "./cloze-colors.js";
