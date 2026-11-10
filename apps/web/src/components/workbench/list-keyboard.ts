"use client";

import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** `/` focuses the page's search box, unless the user is typing or a dialog is open. */
export function useSlashToSearch(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function focusSearch(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [searchRef]);
}

type ListKeyActions = {
  moveFocus: (delta: number) => void;
  toggleFocused: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** Delete / Backspace. */
  onDelete?: () => void;
  /** Enter on the focused row. */
  onOpen?: () => void;
  /** Home and End jump to the first and last row. */
  homeEnd?: boolean;
  /** Page-specific shortcuts; return true when the key was handled. */
  extra?: (event: ReactKeyboardEvent<HTMLElement>, mod: boolean) => boolean;
};

/** The workbench list's keys: arrows, Space, Cmd/Ctrl+A, Delete, Enter, Escape. */
export function handleListKeyDown(e: ReactKeyboardEvent<HTMLElement>, actions: ListKeyActions) {
  const editable = isEditableTarget(e.target);
  if (editable && e.key !== "Escape") return;

  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    actions.selectAll();
    return;
  }

  if (actions.extra?.(e, mod)) return;

  if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
    if (!actions.onDelete) return;
    e.preventDefault();
    actions.onDelete();
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    actions.clearSelection();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    actions.moveFocus(1);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    actions.moveFocus(-1);
    return;
  }

  if (actions.homeEnd && (e.key === "Home" || e.key === "End")) {
    e.preventDefault();
    actions.moveFocus(e.key === "Home" ? -Infinity : Infinity);
    return;
  }

  if (e.key === "Enter" && !mod && actions.onOpen) {
    // Leave Enter alone on buttons and links inside a row.
    if (e.target instanceof HTMLElement && e.target.closest("a, button")) return;
    e.preventDefault();
    actions.onOpen();
    return;
  }

  if (e.key === " " && !mod) {
    if (e.target instanceof HTMLElement && e.target.closest("a, button")) return;
    e.preventDefault();
    actions.toggleFocused();
  }
}
