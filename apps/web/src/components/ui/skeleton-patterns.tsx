import type { CSSProperties } from "react";
import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

const cardSurface: CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-secondary)",
  borderRadius: 8,
};

export function SkeletonStatTile() {
  return (
    <SkeletonBlock style={{ ...cardSurface, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <SkeletonBar width={28} height={28} radius={8} />
      <SkeletonBar width="55%" height={10} />
      <SkeletonBar width="40%" height={20} radius={6} />
    </SkeletonBlock>
  );
}

export function SkeletonStatGrid({ count = 4, columns = 4 }: { count?: number; columns?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 12,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonStatTile key={i} />
      ))}
    </div>
  );
}

export function CardListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBlock
          key={i}
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--border-secondary)",
            background: "var(--bg-surface-2)",
          }}
        >
          <SkeletonBar width="70%" height={14} />
          <SkeletonBar width="40%" height={10} style={{ marginTop: 8 }} />
        </SkeletonBlock>
      ))}
    </div>
  );
}

export function PreviewCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock
          key={i}
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border-secondary)",
            background: "var(--bg-surface-2)",
          }}
        >
          <SkeletonBar width={80} height={10} style={{ marginBottom: 8 }} />
          <SkeletonBar width="95%" height={14} />
          <SkeletonBar width="60%" height={12} style={{ marginTop: 8 }} />
        </SkeletonBlock>
      ))}
    </div>
  );
}

export function EditorPanelSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      <SkeletonBar width={100} height={14} />
      <SkeletonBar width="100%" height={120} radius={8} />
      <SkeletonBar width={80} height={14} />
      <SkeletonBar width="100%" height={120} radius={8} />
      <SkeletonBar width={60} height={14} />
      <SkeletonBar width="100%" height={36} radius={8} />
    </div>
  );
}

/** Text-document placeholder matching a paragraph-heavy editor body. */
export function DocumentSkeleton() {
  const lines = [92, 100, 78, 95, 60, 88, 100, 70, 96, 45, 82, 100, 64];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "32px 40px" }}>
      <SkeletonBar width="38%" height={24} radius={8} style={{ marginBottom: 12 }} />
      {lines.map((w, i) => (
        <SkeletonBar key={i} width={`${w}%`} height={13} />
      ))}
      <SkeletonBar width="30%" height={18} radius={6} style={{ marginTop: 20 }} />
      <SkeletonBar width="96%" height={13} style={{ marginTop: 4 }} />
      <SkeletonBar width="85%" height={13} />
      <SkeletonBar width="70%" height={13} />
    </div>
  );
}

/** Leaderboard-style rows: rank badge + name + score. */
/** Calendar-heatmap placeholder: header row + cell grid. */
/** Compact list placeholder for pickers / connection checks. */
export function ListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid var(--border-secondary)",
            borderRadius: 8,
            background: "var(--bg-surface)",
          }}
        >
          <SkeletonBar width={20} height={20} radius={6} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <SkeletonBar width={`${70 - i * 8}%`} height={12} />
            <SkeletonBar width="40%" height={9} />
          </div>
          <SkeletonBar width={16} height={16} radius={4} />
        </div>
      ))}
    </div>
  );
}

/** Small inline status placeholder (connection checks). */
export function ConnectionStatusSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        border: "1px solid var(--border-secondary)",
        borderRadius: 10,
        background: "var(--bg-surface)",
      }}
    >
      <SkeletonBar width={34} height={34} radius={9} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <SkeletonBar width="45%" height={13} />
        <SkeletonBar width="70%" height={10} />
      </div>
      <SkeletonBar width={74} height={30} radius={8} />
    </div>
  );
}

/** Card-picker list placeholder (the exam form's decks, sources and tags). */
export function CardPickerSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 250 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            border: "1px solid var(--border-secondary)",
            borderRadius: 8,
            background: "var(--bg-surface)",
          }}
        >
          <SkeletonBar width={16} height={16} radius={4} />
          <SkeletonBar width={`${68 - i * 5}%`} height={12} />
          <SkeletonBar width={40} height={20} radius={999} style={{ marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}
