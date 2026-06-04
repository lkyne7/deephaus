"use client";

import {
  cardMediaDisplayUrlSized,
  enabledOcclusionRects,
  occlusionRectOrd,
  parseImageOcclusionData,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { useMemo } from "react";
import "./image-occlusion.css";

type Props = {
  data: ImageOcclusionData | null;
  /** Active cloze group (1–9); all regions with this ord are hidden together. */
  activeOrd?: number | null;
  revealed?: boolean;
  studyView?: boolean;
  className?: string;
};

export function OcclusionRenderer({
  data,
  activeOrd,
  revealed = false,
  studyView = false,
  className,
}: Props) {
  const rects = useMemo(() => (data ? enabledOcclusionRects(data) : []), [data]);
  if (!data?.imageUrl) return null;

  const hideOrd = activeOrd != null && activeOrd > 0 ? activeOrd : null;
  const hintRects = useMemo(() => {
    if (revealed || hideOrd == null) return [];
    return rects.filter(
      (rect) => occlusionRectOrd(rect) === hideOrd && rect.label?.trim(),
    );
  }, [rects, hideOrd, revealed]);

  return (
    <div
      className={`io-canvas-wrap io-study-preview${revealed ? " is-revealed" : ""}${className ? ` ${className}` : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cardMediaDisplayUrlSized(data.imageUrl, studyView ? "study" : "preview")}
        alt="Occlusion image"
        draggable={false}
      />
      <svg className="io-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {rects.map((rect) => {
          const ord = occlusionRectOrd(rect);
          const isTarget = hideOrd === ord && !revealed;
          return (
            <rect
              key={rect.id}
              className={`io-rect io-rect--c${ord}${isTarget ? " io-study-hide" : ""}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={0.008}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {hintRects.length > 0 ? (
        <div className="io-region-hints" aria-hidden={false}>
          {hintRects.map((rect) => (
            <HintOverlay key={rect.id} rect={rect} label={rect.label!.trim()} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HintOverlay({ rect, label }: { rect: OcclusionRect; label: string }) {
  return (
    <span
      className="io-region-hint-slot"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    >
      <span className="io-region-hint-text">{label}</span>
    </span>
  );
}

export function occlusionDataFromCard(
  occlusionData: unknown,
  front: string | null | undefined,
): ImageOcclusionData | null {
  const parsed = parseImageOcclusionData(occlusionData);
  if (parsed) return parsed;
  return null;
}
