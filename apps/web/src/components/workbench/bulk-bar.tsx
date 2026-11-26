"use client";

import type { ReactNode } from "react";

/** The floating bar shown while several rows are selected. */
export function BulkBar({
  count,
  label,
  onClear,
  selectAll,
  children,
}: {
  count: number;
  /** Accessible name, e.g. "Selected cards". */
  label: string;
  onClear: () => void;
  /** Offered while some rows are left out, e.g. { label: "Select all 40", onSelect }. */
  selectAll?: { label: string; onSelect: () => void } | null;
  children: ReactNode;
}) {
  return (
    <div className="dh-bench-bulk">
      <div
        className="dh-bench-bulk__bar"
        role="toolbar"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClear();
        }}
      >
        <span className="dh-bench-bulk__count">{count} selected</span>
        {selectAll ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll.onSelect}>
              {selectAll.label}
            </button>
            <span className="dh-bench-bulk__sep" aria-hidden />
          </>
        ) : null}
        {children}
        <span className="dh-bench-bulk__sep" aria-hidden />
        <button
          type="button"
          className="dh-bench-iconbtn"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * "Select all" beside a list's count, or "Clear selection" once every row is
 * selected. Hidden when the list has fewer than two rows.
 */
export function SelectAllToggle({
  rowCount,
  allSelected,
  onSelectAll,
  onClear,
  title,
}: {
  rowCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  /** Says what "all" covers, e.g. "Select the 50 loaded cards". */
  title?: string;
}) {
  if (rowCount < 2) return null;
  return allSelected ? (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
      Clear selection
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onSelectAll}
      title={title}
      aria-keyshortcuts="Meta+A Control+A"
    >
      Select all
    </button>
  );
}
