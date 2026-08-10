"use client";

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Sidebar-style hover tip, portaled so a rail can keep overflow:hidden
 * (clean borders) without clipping the label.
 */
export function RailHoverTip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: (handlers: {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  }) => ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const onMouseEnter = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!enabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
    },
    [enabled],
  );

  const onMouseLeave = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!enabled) setPos(null);
  }, [enabled]);

  return (
    <>
      {children({ onMouseEnter, onMouseLeave })}
      {pos
        ? createPortal(
            <span
              className="notion-sidebar-hover-label dh-rail-hover-tip"
              style={{ top: pos.top, left: pos.left }}
              role="tooltip"
              aria-hidden
            >
              <span className="notion-sidebar-hover-label-text">{label}</span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
