import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

export default function CramLoading() {
  return (
    <div className="cram-page" aria-busy aria-label="Loading cram plans">
      {/* Calendar */}
      <SkeletonBlock
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-secondary)",
          borderRadius: 12,
          padding: "18px 20px",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <SkeletonBar width={130} height={16} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <SkeletonBar width={26} height={26} radius={8} />
            <SkeletonBar width={128} height={16} />
            <SkeletonBar width={26} height={26} radius={8} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
          {Array.from({ length: 7 }, (_, i) => (
            <SkeletonBar key={`dow-${i}`} width="60%" height={10} style={{ margin: "0 auto 6px" }} />
          ))}
          {Array.from({ length: 35 }, (_, i) => (
            <SkeletonBar key={i} width="100%" height={52} radius={6} />
          ))}
        </div>
      </SkeletonBlock>

      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "20px 0 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SkeletonBar width={20} height={20} radius={6} />
          <SkeletonBar width={120} height={22} radius={6} />
          <SkeletonBar width={28} height={22} radius={999} />
        </div>
        <SkeletonBar width={120} height={32} radius={8} />
      </div>

      {/* Plan cards grid */}
      <div className="cram-plan-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="cram-plan-card" aria-hidden>
            <div className="skeleton-line" style={{ width: "38%", height: 22 }} />
            <div className="skeleton-line" style={{ width: "72%", height: 20 }} />
            <div className="skeleton-line" style={{ width: "100%", height: 6, marginTop: 16 }} />
            <div className="skeleton-line" style={{ width: "52%", height: 28, marginTop: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
