import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";
import { OVERVIEW_PANEL_MIN_HEIGHT } from "@/components/dashboard/overview-panel-layout";
import { DASHBOARD_DECK_ROW_LIMIT } from "@/lib/fsrs/dashboard-decks";

const panelFillStyle = {
  height: "100%",
  minHeight: OVERVIEW_PANEL_MIN_HEIGHT,
  boxSizing: "border-box" as const,
};

export function HeatmapPanelSkeleton() {
  return (
    <SkeletonBlock
      style={{
        flex: 1,
        minWidth: 0,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-secondary)",
        borderRadius: 8,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <SkeletonBar width={56} height={24} radius={8} />
        <SkeletonBar width="min(280px, 55%)" height={14} />
      </div>
      <SkeletonBar width="100%" height={140} radius={10} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SkeletonBar width={32} height={10} />
        <SkeletonBar width={180} height={12} />
      </div>
    </SkeletonBlock>
  );
}

export function CardStatePanelSkeleton() {
  return (
    <SkeletonBlock
      style={{
        width: "100%",
        flexShrink: 0,
        ...panelFillStyle,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-secondary)",
        borderRadius: 8,
        padding: "18px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <SkeletonBar width={100} height={100} radius={50} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonBar width="90%" height={10} />
          <SkeletonBar width="75%" height={10} />
          <SkeletonBar width="85%" height={10} />
          <SkeletonBar width="60%" height={10} />
        </div>
      </div>
      <SkeletonBar width="100%" height={1} radius={0} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <SkeletonBar width="100%" height={36} radius={8} />
        <SkeletonBar width="100%" height={36} radius={8} />
      </div>
      <SkeletonBar width="88%" height={12} />
    </SkeletonBlock>
  );
}

export function DeckCardSkeleton() {
  return (
    <SkeletonBlock
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-secondary)",
        borderRadius: 8,
        padding: 16,
        minHeight: 168,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <SkeletonBar width="72%" height={16} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <SkeletonBar width={88} height={22} radius={999} />
        <SkeletonBar width={72} height={22} radius={999} />
        <SkeletonBar width={64} height={22} radius={999} />
      </div>
      <SkeletonBar width="55%" height={12} />
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
        <SkeletonBar width={96} height={32} radius={8} />
      </div>
    </SkeletonBlock>
  );
}

export function SectionHeaderSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBar width={20} height={20} radius={6} />
        <SkeletonBar width={180} height={22} radius={6} />
        <SkeletonBar width={32} height={22} radius={999} />
      </div>
      <SkeletonBar width={80} height={14} />
    </div>
  );
}

export function CommunitySectionSkeleton() {
  return (
    <section>
      <SectionHeaderSkeleton />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${DASHBOARD_DECK_ROW_LIMIT}, minmax(200px, 1fr))`,
          gap: 16,
          overflowX: "auto",
        }}
      >
        {Array.from({ length: DASHBOARD_DECK_ROW_LIMIT }, (_, i) => (
          <DeckCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

export function DecksSectionSkeleton() {
  return (
    <section>
      <SectionHeaderSkeleton />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${DASHBOARD_DECK_ROW_LIMIT}, minmax(200px, 1fr))`,
          gap: 16,
          overflowX: "auto",
        }}
      >
        {Array.from({ length: DASHBOARD_DECK_ROW_LIMIT }, (_, i) => (
          <DeckCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section>
        <SectionHeaderSkeleton />
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "stretch",
            flexWrap: "wrap",
            minHeight: OVERVIEW_PANEL_MIN_HEIGHT,
            ["--overview-panel-min-height" as string]: `${OVERVIEW_PANEL_MIN_HEIGHT}px`,
          }}
        >
          <div style={{ width: 248, flexShrink: 0, display: "flex" }}>
            <CardStatePanelSkeleton />
          </div>
          <div style={{ flex: 1, minWidth: 280, display: "flex" }}>
            <HeatmapPanelSkeleton />
          </div>
        </div>
      </section>
      <DecksSectionSkeleton />
      <CommunitySectionSkeleton />
    </div>
  );
}
