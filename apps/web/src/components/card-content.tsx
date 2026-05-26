"use client";

import { parseCardContent } from "@deephaus/shared";
import type { CSSProperties } from "react";

type Props = {
  text: string | null | undefined;
  inline?: boolean;
  style?: CSSProperties;
  imageStyle?: CSSProperties;
};

export function CardContent({ text, inline, style, imageStyle }: Props) {
  if (!text) return null;

  const segments = parseCardContent(text);
  if (segments.length === 0) return null;

  return (
    <div
      className={inline ? "card-content card-content--inline" : "card-content"}
      style={style}
    >
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          segment.value ? <span key={index}>{segment.value}</span> : null
        ) : (
          // Card images are user-uploaded URLs from our storage bucket.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={segment.src}
            alt={segment.alt}
            className="card-content__image"
            style={imageStyle}
            loading="lazy"
          />
        ),
      )}
    </div>
  );
}
