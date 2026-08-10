import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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

  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)$/,
        handler: ({ state, range, match }) => {
          const formula = match[1]?.trim();
          if (!formula) return null;
          const { tr } = state;
          const node = this.type.create({ formula });
          tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
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

  addInputRules() {
    return [
      new InputRule({
        find: /\$\$([\s\S]+?)\$\$$/,
        handler: ({ state, range, match }) => {
          const formula = match[1]?.trim();
          if (!formula) return null;
          const { tr } = state;
          const node = this.type.create({ formula });
          tr.replaceWith(range.from, range.to, node);

          // Replacing inline text with a block atom leaves a NodeSelection on
          // the equation. The next typed character would therefore replace
          // the whole equation. Add a paragraph after it and move the caret
          // there so users can continue typing normally.
          let insertedPos: number | null = null;
          let nearestDistance = Number.POSITIVE_INFINITY;
          tr.doc.descendants((candidate, pos) => {
            if (
              candidate.type === this.type &&
              candidate.attrs.formula === formula
            ) {
              const distance = Math.abs(pos - range.from);
              if (distance < nearestDistance) {
                nearestDistance = distance;
                insertedPos = pos;
              }
            }
          });

          if (insertedPos != null) {
            const afterEquation = insertedPos + node.nodeSize;
            const $after = tr.doc.resolve(afterEquation);
            if (!$after.nodeAfter?.isTextblock) {
              const paragraph = state.schema.nodes.paragraph?.create();
              if (
                paragraph &&
                $after.parent.canReplaceWith(
                  $after.index(),
                  $after.index(),
                  paragraph.type,
                )
              ) {
                tr.insert(afterEquation, paragraph);
              }
            }

            const cursorPos = Math.min(
              afterEquation + 1,
              tr.doc.content.size,
            );
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(cursorPos), 1),
            );
          }
        },
      }),
    ];
  },
});
