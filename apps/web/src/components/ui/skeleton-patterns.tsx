import type { CSSProperties } from "react";
import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

const cardSurface: CSSProperties = {
  background: "var(--white)",
  border: "1px solid var(--border-2)",
  borderRadius: 12,
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
          <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-1)" }}>
            <SkeletonBar width={16} height={16} radius={4} />
          </td>
          {Array.from({ length: columns - 1 }, (_, col) => (
            <td key={col} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-1)" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "24px 32px", minHeight: 400 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <SkeletonBar width={200} height={36} radius={8} />
        <SkeletonBar width={160} height={36} radius={8} />
        <SkeletonBar width={240} height={36} radius={8} />
      </div>
      <SkeletonBlock style={{ ...cardSurface, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--paper-soft)" }}>
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

export function ProfilePageSkeleton() {
  return (
    <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <SkeletonBlock style={{ ...cardSurface, padding: 24 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <SkeletonBar width={56} height={56} radius={28} />
          <div style={{ flex: 1 }}>
            <SkeletonBar width={160} height={20} style={{ marginBottom: 8 }} />
            <SkeletonBar width={220} height={14} />
            <SkeletonBar width={140} height={12} style={{ marginTop: 8 }} />
          </div>
          <SkeletonBar width={88} height={32} radius={8} />
        </div>
        <SkeletonBar width="100%" height={40} radius={8} style={{ marginTop: 20 }} />
      </SkeletonBlock>
      <SkeletonStatGrid count={4} columns={4} />
      <SkeletonBlock style={{ ...cardSurface, padding: 24, minHeight: 140 }}>
        <SkeletonBar width={180} height={18} style={{ marginBottom: 8 }} />
        <SkeletonBar width="100%" height={12} />
        <SkeletonBar width="90%" height={12} style={{ marginTop: 6 }} />
        <SkeletonBar width="100%" height={8} radius={4} style={{ marginTop: 20 }} />
        <SkeletonBar width={120} height={32} radius={8} style={{ marginTop: 16 }} />
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
            border: "1px solid var(--border-1)",
            background: "var(--paper-soft)",
          }}
        >
          <SkeletonBar width="70%" height={14} />
          <SkeletonBar width="40%" height={10} style={{ marginTop: 8 }} />
        </SkeletonBlock>
      ))}
    </div>
  );
}

export function CommunityGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SkeletonBar width="100%" height={40} radius={8} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonBlock key={i} style={{ ...cardSurface, padding: 16, minHeight: 140 }}>
            <SkeletonBar width="80%" height={16} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <SkeletonBar width={88} height={22} radius={999} />
              <SkeletonBar width={100} height={22} radius={999} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto", paddingTop: 12 }}>
              <SkeletonBar width={72} height={32} radius={8} />
              <SkeletonBar width={96} height={32} radius={8} />
            </div>
          </SkeletonBlock>
        ))}
      </div>
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
            border: "1px solid var(--border-1)",
            background: "var(--paper-soft)",
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
