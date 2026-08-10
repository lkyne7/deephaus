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

export function SkeletonTableRows({
  rows = 8,
  columns = 3,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-secondary)" }}>
            <SkeletonBar width={16} height={16} radius={4} />
          </td>
          {Array.from({ length: columns - 1 }, (_, col) => (
            <td key={col} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-secondary)" }}>
              <SkeletonBar width={col === 0 ? "85%" : "70%"} height={12} />
              {col === 0 ? <SkeletonBar width="45%" height={10} style={{ marginTop: 6 }} /> : null}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function BrowsePageSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 0", minHeight: 400 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <SkeletonBar width={200} height={36} radius={8} />
        <SkeletonBar width={160} height={36} radius={8} />
        <SkeletonBar width={240} height={36} radius={8} />
      </div>
      <SkeletonBlock style={{ ...cardSurface, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface-2)" }}>
              {["", "Front", "Back", "Tags"].map((_, i) => (
                <th key={i} style={{ padding: "10px 14px", textAlign: "left" }}>
                  <SkeletonBar width={i === 0 ? 16 : 56} height={10} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SkeletonTableRows rows={10} columns={4} />
          </tbody>
        </table>
      </SkeletonBlock>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SkeletonBar width={120} height={12} />
        <SkeletonBar width={80} height={32} radius={8} />
      </div>
    </div>
  );
}

export function StudyCardSkeleton() {
  return (
    <div className="surface" style={{ padding: 32, maxWidth: 560, margin: "0 auto", width: "100%" }}>
      <SkeletonBar width="30%" height={12} style={{ marginBottom: 20 }} />
      <SkeletonBar width="100%" height={18} />
      <SkeletonBar width="92%" height={18} style={{ marginTop: 10 }} />
      <SkeletonBar width="75%" height={18} style={{ marginTop: 10 }} />
      <SkeletonBar width="100%" height={120} radius={10} style={{ marginTop: 24 }} />
      <div style={{ display: "flex", gap: 10, marginTop: 28, justifyContent: "center" }}>
        {[1, 2, 3, 4].map((i) => (
          <SkeletonBar key={i} width={72} height={40} radius={8} />
        ))}
      </div>
    </div>
  );
}

export function AdvancedStatsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SkeletonStatGrid count={8} columns={4} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SkeletonBlock style={{ ...cardSurface, padding: 16, minHeight: 160 }}>
          <SkeletonBar width={100} height={14} style={{ marginBottom: 12 }} />
          <SkeletonBar width="100%" height={100} radius={8} />
        </SkeletonBlock>
        <SkeletonBlock style={{ ...cardSurface, padding: 16, minHeight: 160 }}>
          <SkeletonBar width={120} height={14} style={{ marginBottom: 12 }} />
          <SkeletonBar width="100%" height={100} radius={8} />
        </SkeletonBlock>
      </div>
      <SkeletonBlock style={{ ...cardSurface, padding: 16, minHeight: 120 }}>
        <SkeletonBar width={140} height={14} style={{ marginBottom: 12 }} />
        <SkeletonBar width="100%" height={72} radius={8} />
      </SkeletonBlock>
    </div>
  );
}

export function DeckOverviewSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[88, 72, 64, 100, 110].map((w, i) => (
          <SkeletonBar key={i} width={w} height={28} radius={999} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>
        <SkeletonBlock style={{ ...cardSurface, padding: 20, minHeight: 200 }}>
          <SkeletonBar width={100} height={14} style={{ marginBottom: 8 }} />
          <SkeletonBar width="100%" height={80} radius={8} />
          <SkeletonBar width={120} height={14} style={{ marginTop: 20, marginBottom: 8 }} />
          <SkeletonBar width="100%" height={120} radius={8} />
        </SkeletonBlock>
        <SkeletonBlock style={{ ...cardSurface, padding: 16, minHeight: 200 }}>
          <SkeletonBar width={80} height={14} style={{ marginBottom: 12 }} />
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBar key={i} width="100%" height={36} radius={8} style={{ marginBottom: 8 }} />
          ))}
        </SkeletonBlock>
      </div>
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

/** Mirrors the notes grid: icon + type + date header, 2-line title, deck footer. */
export function NoteCardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
        gap: 14,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 16,
            borderRadius: 10,
            border: "1px solid var(--border-secondary)",
            background: "var(--white)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SkeletonBar width={16} height={16} radius={4} />
            <SkeletonBar width={44} height={10} />
            <SkeletonBar width={40} height={10} style={{ marginLeft: "auto" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <SkeletonBar width={`${82 - (i % 3) * 10}%`} height={14} />
            <SkeletonBar width={`${55 - (i % 2) * 12}%`} height={14} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <SkeletonBar width={13} height={13} radius={4} />
            <SkeletonBar width="42%" height={11} />
          </div>
        </SkeletonBlock>
      ))}
    </div>
  );
}

/** Single community deck card: icon+title, 3 chips, tag + action footer. */
function CommunityDeckCardSkeleton() {
  return (
    <SkeletonBlock
      style={{
        ...cardSurface,
        padding: 16,
        minHeight: 168,
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SkeletonBar width={16} height={16} radius={4} />
        <SkeletonBar width="62%" height={15} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <SkeletonBar width={72} height={22} radius={999} />
        <SkeletonBar width={104} height={22} radius={999} />
        <SkeletonBar width={60} height={22} radius={999} />
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingTop: 4,
        }}
      >
        <SkeletonBar width={84} height={24} radius={999} />
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBar width={68} height={32} radius={8} />
          <SkeletonBar width={92} height={32} radius={8} />
        </div>
      </div>
    </SkeletonBlock>
  );
}

export function CommunityGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SkeletonBar width={260} height={36} radius={8} />
        <SkeletonBar width={140} height={36} radius={8} style={{ marginLeft: "auto" }} />
        <SkeletonBar width={96} height={36} radius={8} />
      </div>
      {/* Featured grid */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SkeletonBar width={16} height={16} radius={4} />
          <SkeletonBar width={130} height={18} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <CommunityDeckCardSkeleton key={`f-${i}`} />
          ))}
        </div>
      </section>
      {/* All decks grid */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SkeletonBar width={16} height={16} radius={4} />
          <SkeletonBar width={90} height={18} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {Array.from({ length: count }, (_, i) => (
            <CommunityDeckCardSkeleton key={i} />
          ))}
        </div>
      </section>
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
export function LeaderboardRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 200, justifyContent: "center" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
          <SkeletonBar width={30} height={30} radius={8} />
          <SkeletonBar width={`${62 - i * 6}%`} height={14} />
          <SkeletonBar width={40} height={14} style={{ marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

/** Calendar-heatmap placeholder: header row + cell grid. */
export function HeatmapSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 220 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SkeletonBar width={140} height={16} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SkeletonBar width={28} height={28} radius={8} />
          <SkeletonBar width={48} height={16} />
          <SkeletonBar width={28} height={28} radius={8} />
        </div>
      </div>
      <SkeletonBlock
        style={{
          border: "1px solid var(--border-secondary)",
          borderRadius: 10,
          background: "var(--bg-surface)",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {Array.from({ length: 7 }, (_, i) => (
            <SkeletonBar
              key={i}
              width={i === 0 ? 18 : 12}
              height={10}
              style={i === 0 ? undefined : { flex: 1 }}
            />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {Array.from({ length: 7 }, (_, row) => (
            <div key={row} style={{ display: "flex", gap: 4 }}>
              <SkeletonBar width={18} height={12} />
              {Array.from({ length: 24 }, (_, col) => (
                <span
                  key={col}
                  className="skeleton-bar"
                  aria-hidden
                  style={{ display: "block", flex: 1, height: 12, borderRadius: 3 }}
                />
              ))}
            </div>
          ))}
        </div>
      </SkeletonBlock>
    </div>
  );
}

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

/** Card-picker list placeholder (cram plan creator options). */
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
