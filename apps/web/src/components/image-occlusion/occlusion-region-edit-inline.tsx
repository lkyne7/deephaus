"use client";

import { CLOZE_IDS, clozeNumber } from "@deephaus/rich-text";
import { occlusionOrdLabel, occlusionRectOrd, type OcclusionRect } from "@deephaus/shared";
import { useEffect, useRef, useState } from "react";
import "@/components/rich-text/rich-text.css";

type Props = {
  rect: OcclusionRect;
  disabled?: boolean;
  onOrdChange: (ord: number) => void;
  onHintCommit: (hint: string) => void;
};

export function OcclusionRegionEditInline({
  rect,
  disabled,
  onOrdChange,
  onHintCommit,
}: Props) {
  const ord = occlusionRectOrd(rect);
  const activeId = `c${ord}`;
  const hasHint = Boolean(rect.label?.trim());
  const [hintDraft, setHintDraft] = useState(rect.label ?? "");
  const hintInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHintDraft(rect.label ?? "");
  }, [rect.id, rect.label]);

  useEffect(() => {
    const t = window.setTimeout(() => hintInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [rect.id]);

  function commitHint(value: string) {
    onHintCommit(value.trim());
  }

  return (
    <div
      className="dh-cloze-edit-menu io-region-edit-inline"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="dh-cloze-edit-menu__header">
        <span className={`dh-cloze dh-cloze--${activeId} dh-cloze-edit-menu__badge`}>
          {occlusionOrdLabel(ord)}
        </span>
        <span className="dh-cloze-edit-menu__title">Occlusion region</span>
        {hasHint ? <span className="dh-cloze-edit-menu__hint-badge">Hint</span> : null}
      </div>

      <div className="dh-cloze-edit-menu__ids" role="group" aria-label="Cloze group">
        {CLOZE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`dh-cloze-edit-menu__id dh-cloze dh-cloze--${id}${activeId === id ? " is-active" : ""}`}
            disabled={disabled}
            aria-pressed={activeId === id}
            title={`Set ${id.toUpperCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onOrdChange(clozeNumber(id))}
          >
            {id.toUpperCase()}
          </button>
        ))}
      </div>

      <label className="dh-cloze-edit-menu__hint-row">
        <span className="dh-cloze-edit-menu__hint-label">Hint</span>
        <input
          ref={hintInputRef}
          type="text"
          className="dh-cloze-edit-menu__hint-input"
          value={hintDraft}
          disabled={disabled}
          placeholder="Optional hint shown when studying"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => setHintDraft(event.target.value)}
          onBlur={() => commitHint(hintDraft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHint(hintDraft);
            }
          }}
        />
      </label>

      <p className="io-region-edit-inline__note">
        Regions with the same group share one study card, like cloze C1, C1.
      </p>
    </div>
  );
}
