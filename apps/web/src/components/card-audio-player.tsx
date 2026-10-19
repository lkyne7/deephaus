"use client";
import type { CSSProperties } from "react";
import { useMediaUri } from "@/lib/offline/media";

type Props = {
  /** The clip's canonical URL; the offline cache is keyed by it. */
  original: string;
  title: string;
  style?: CSSProperties;
  className?: string;
};

/** A card's audio clip: native controls, served from the offline cache when present. */
export function CardAudioPlayer({ original, title, style, className }: Props) {
  const uri = useMediaUri(original, original);
  return (
    <figure
      className={`card-audio-player${className ? ` ${className}` : ""}`}
      style={{ ...s.frame, ...style }}
      data-card-audio={original}
    >
      <figcaption style={s.caption}>
        <i className="ri-volume-up-line" aria-hidden style={s.icon} />
        <span style={s.title}>{title}</span>
      </figcaption>
      <audio controls preload="metadata" src={uri} style={s.audio} aria-label={title} />
    </figure>
  );
}

const s: Record<string, CSSProperties> = {
  frame: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    maxWidth: 520,
    margin: "8px auto",
    padding: "8px 12px",
    border: "1px solid var(--border-2)",
    borderRadius: 10,
    background: "var(--bg-subtle, var(--white))",
    textAlign: "left",
  },
  caption: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    maxWidth: 180,
  },
  icon: { color: "var(--ink-500)", flexShrink: 0 },
  title: {
    font: "500 13px/1.3 var(--font-sans)",
    color: "var(--ink-700)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  audio: { flex: 1, minWidth: 0, height: 32 },
};
