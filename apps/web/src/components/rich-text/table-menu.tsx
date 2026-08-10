"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type TableChain = {
  focus: () => TableChain;
  addRowBefore: () => TableChain;
  addRowAfter: () => TableChain;
  addColumnBefore: () => TableChain;
  addColumnAfter: () => TableChain;
  deleteRow: () => TableChain;
  deleteColumn: () => TableChain;
  toggleHeaderRow: () => TableChain;
  deleteTable: () => TableChain;
  run: () => boolean;
};

function tableChain(editor: Editor): TableChain {
  return editor.chain().focus() as unknown as TableChain;
}

type Anchor = { top: number; left: number };

/** Floating controls shown while the selection is inside a table. */
export function TableMenu({ editor, onEdit }: { editor: Editor; onEdit?: () => void }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    const update = () => {
      if (editor.isDestroyed || !editor.isEditable || !editor.isActive("table")) {
        setAnchor(null);
        return;
      }
      const { from } = editor.state.selection;
      const domAt = editor.view.domAtPos(from);
      const element =
        domAt.node instanceof HTMLElement ? domAt.node : domAt.node.parentElement;
      const table = element?.closest("table");
      if (!table) {
        setAnchor(null);
        return;
      }
      const rect = table.getBoundingClientRect();
      setAnchor({
        top: Math.max(rect.top - 40, 8),
        left: Math.max(rect.left, 8),
      });
    };

    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  if (!anchor) return null;

  const act = (fn: (chain: TableChain) => TableChain) => {
    onEdit?.();
    fn(tableChain(editor)).run();
  };

  const buttons: Array<{ icon: string; label: string; run: (chain: TableChain) => TableChain; danger?: boolean }> = [
    { icon: "ri-insert-row-top", label: "Add row above", run: (c) => c.addRowBefore() },
    { icon: "ri-insert-row-bottom", label: "Add row below", run: (c) => c.addRowAfter() },
    { icon: "ri-insert-column-left", label: "Add column left", run: (c) => c.addColumnBefore() },
    { icon: "ri-insert-column-right", label: "Add column right", run: (c) => c.addColumnAfter() },
    { icon: "ri-delete-row", label: "Delete row", run: (c) => c.deleteRow() },
    { icon: "ri-delete-column", label: "Delete column", run: (c) => c.deleteColumn() },
    { icon: "ri-layout-row-line", label: "Toggle header row", run: (c) => c.toggleHeaderRow() },
    { icon: "ri-delete-bin-line", label: "Delete table", run: (c) => c.deleteTable(), danger: true },
  ];

  return createPortal(
    <div className="dh-table-menu" role="toolbar" aria-label="Table options" style={anchor}>
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          className={`dh-table-menu__btn${button.danger ? " is-danger" : ""}`}
          title={button.label}
          aria-label={button.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => act(button.run)}
        >
          <i className={button.icon} aria-hidden />
        </button>
      ))}
    </div>,
    document.body,
  );
}
