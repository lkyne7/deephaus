import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    latexInline: {
      insertLatexInline: (formula?: string) => ReturnType;
    };
    latexBlock: {
      insertLatexBlock: (formula?: string) => ReturnType;
    };
  }
}

export function renderKatex(formula: string, displayMode: boolean): string {
  try {
    return katex.renderToString(formula, {
      throwOnError: false,
      displayMode,
      output: "html",
    });
  } catch {
    return formula;
  }
}

function createLatexNodeView(displayMode: boolean) {
  return ({ node }: { node: { attrs: { formula?: string }; type: { name: string } } }) => {
    const typeName = node.type.name;
    const tag = displayMode ? "div" : "span";
    const dom = document.createElement(tag);
    dom.className = displayMode ? "dh-latex-block" : "dh-latex-inline";
    dom.setAttribute("data-type", displayMode ? "latex-block" : "latex-inline");
    dom.contentEditable = "false";

    let currentFormula = String(node.attrs.formula ?? "");

    const render = (formula: string) => {
      currentFormula = formula;
      dom.setAttribute("data-latex-formula", formula);
      dom.innerHTML = renderKatex(formula, displayMode);
    };

    render(currentFormula);

    return {
      dom,
      update(updatedNode: { type: { name: string }; attrs: { formula?: string } }) {
        if (updatedNode.type.name !== typeName) return false;
        const nextFormula = String(updatedNode.attrs.formula ?? "");
        if (nextFormula === currentFormula) return true;
        render(nextFormula);
        return true;
      },
    };
  };
}

export const LatexInline = Node.create({
  name: "latexInline",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex-formula") ?? "",
        renderHTML: (attributes) => ({
          "data-latex-formula": attributes.formula,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="latex-inline"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "latex-inline",
        class: "dh-latex-inline",
      }),
    ];
  },

  addNodeView() {
    return createLatexNodeView(false);
  },

  addCommands() {
    return {
      insertLatexInline:
        (formula = "") =>
        ({ chain, state }) => {
          const { from, to } = state.selection;
          const selected = state.doc.textBetween(from, to, " ");
          const value = formula || selected || "x";
          return chain()
            .focus()
            .deleteSelection()
            .insertContent({
              type: this.name,
              attrs: { formula: value },
            })
            .run();
        },
    };
  },
});

export const LatexBlock = Node.create({
  name: "latexBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex-formula") ?? "",
        renderHTML: (attributes) => ({
          "data-latex-formula": attributes.formula,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="latex-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "latex-block",
        class: "dh-latex-block",
      }),
    ];
  },

  addNodeView() {
    return createLatexNodeView(true);
  },

  addCommands() {
    return {
      insertLatexBlock:
        (formula = "") =>
        ({ chain, state }) => {
          const { from, to } = state.selection;
          const selected = state.doc.textBetween(from, to, " ");
          const value = formula || selected || "\\frac{a}{b}";
          return chain()
            .focus()
            .deleteSelection()
            .insertContent({
              type: this.name,
              attrs: { formula: value },
            })
            .run();
        },
    };
  },
});
