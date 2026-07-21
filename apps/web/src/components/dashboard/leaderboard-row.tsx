"use client";

import type { LeaderboardEntry } from "@/lib/stats/leaderboard";

/** Gold / silver / bronze chips for the podium; neutral rank text below. */
const MEDAL_TINTS: Record<number, { bg: string; fg: string }> = {
  1: { bg: "color-mix(in srgb, #f5b301 18%, transparent)", fg: "#b07d00" },
  2: { bg: "color-mix(in srgb, #9aa4b2 22%, transparent)", fg: "#5f6b7a" },
  3: { bg: "color-mix(in srgb, #c9762b 18%, transparent)", fg: "#a05a1c" },
};

export function LeaderboardRow({
  entry,
  compact = false,
}: {
  entry: LeaderboardEntry;
  compact?: boolean;
}) {
  const medal = MEDAL_TINTS[entry.rank];
  const displayName =
    entry.username === "you" ? "You" : `@${entry.username}${entry.isMe ? " (you)" : ""}`;

  return (
    <div
      style={{
        ...s.row,
        ...(compact ? s.rowCompact : null),
        ...(entry.isMe ? s.rowMe : null),
      }}
    >
      <span
        style={{
          ...s.rankChip,
          ...(compact ? s.rankChipCompact : null),
          ...(medal
            ? { background: medal.bg, color: medal.fg }
            : { background: "var(--bg-surface-2)", color: "var(--fg-4)" }),
        }}
      >
        {medal ? <i className="ri-trophy-fill" aria-hidden /> : `#${entry.rank}`}
      </span>
      <span style={{ ...s.name, ...(compact ? s.nameCompact : null) }} title={displayName}>
        {displayName}
      </span>
      <span style={{ ...s.reviews, ...(compact ? s.reviewsCompact : null) }}>
        {entry.reviews.toLocaleString()}
      </span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    padding: "8px 10px",
    borderRadius: 10,
  },
  rowCompact: {
    padding: "2px 0",
    borderRadius: 8,
  },
  rowMe: {
    background: "color-mix(in srgb, var(--brand-500) 10%, transparent)",
    padding: "8px 10px",
  },
  rankChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    flexShrink: 0,
    font: "600 12px/1 var(--font-sans)",
    fontSize: 14,
  },
  rankChipCompact: {
    width: 26,
    height: 26,
    fontSize: 13,
  },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    font: "500 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  nameCompact: {
    font: "500 13px/18px var(--font-sans)",
  },
  reviews: {
    flexShrink: 0,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-800)",
    fontVariantNumeric: "tabular-nums",
  },
  reviewsCompact: {
    font: "600 13px/18px var(--font-sans)",
  },
};
