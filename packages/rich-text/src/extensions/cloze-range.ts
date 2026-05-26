import type { CommandProps, Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export function getClozeHintInRange(state: EditorState, from: number, to: number): string | null {
  const clozeType = state.schema.marks.cloze;
  if (!clozeType) return null;

  let hint: string | null | undefined;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === clozeType);
    if (!mark) return;
    const next = (mark.attrs.hint as string | null | undefined) ?? null;
    if (hint === undefined) {
      hint = next;
      return;
    }
    if (hint !== next) {
      hint = null;
    }
  });
  return hint ?? null;
}

export function removeClozeInRange(tr: Transaction, from: number, to: number): Transaction {
  const clozeType = tr.doc.type.schema.marks.cloze;
  if (!clozeType) return tr;
  return tr.removeMark(from, to, clozeType);
}

export function createApplyClozeCommand(
  from: number,
  to: number,
  attrs: { id: string; hint?: string | null },
) {
  return ({ tr, state }: CommandProps) => {
    if (from >= to) return false;

    const clozeType = state.schema.marks.cloze;
    if (!clozeType) return false;

    const hint =
      attrs.hint !== undefined ? attrs.hint : getClozeHintInRange(state, from, to);

    removeClozeInRange(tr, from, to);
    tr.addMark(from, to, clozeType.create({ id: attrs.id, hint: hint ?? null }));
    return true;
  };
}

export function applyClozeMarkToRange(
  editor: Editor,
  from: number,
  to: number,
  attrs: { id: string; hint?: string | null },
): boolean {
  if (from >= to) return false;

  return editor
    .chain()
    .command(createApplyClozeCommand(from, to, attrs))
    .setTextSelection({ from, to })
    .run();
}
