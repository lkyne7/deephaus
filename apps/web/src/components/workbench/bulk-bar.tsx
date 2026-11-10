"use client";

import type { ReactNode } from "react";

/** The floating bar shown while several rows are selected. */
export function BulkBar({
  count,
  label,
  onClear,
  children,
}: {
  count: number;
  /** Accessible name, e.g. "Selected cards". */
  label: string;
  onClear: () => void;
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
