import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

export default function NewCramPlanLoading() {
  return (
    <div className="cram-page" aria-busy aria-label="Loading cram plan creator">
      <div className="cram-page-narrow">
        <SkeletonBlock
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-secondary)",
            borderRadius: 12,
            padding: "24px 24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* Stepper */}
          <div style={{ display: "flex", gap: 24, justifyContent: "space-between" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <SkeletonBar width={22} height={22} radius={999} />
                <SkeletonBar width="70%" height={11} />
              </div>
            ))}
          </div>
          <SkeletonBar width="46%" height={22} radius={6} style={{ marginTop: 6 }} />
          <SkeletonBar width="60%" height={12} />
          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {[88, 96, 80].map((w, i) => (
              <SkeletonBar key={i} width={w} height={34} radius={8} />
            ))}
          </div>
          <SkeletonBar width="100%" height={36} radius={8} />
          {/* Option rows */}
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                border: "1px solid var(--border-secondary)",
                borderRadius: 8,
              }}
            >
              <SkeletonBar width={16} height={16} radius={4} />
              <SkeletonBar width={`${68 - i * 5}%`} height={12} />
              <SkeletonBar width={40} height={20} radius={999} style={{ marginLeft: "auto" }} />
            </div>
          ))}
        </SkeletonBlock>
      </div>
    </div>
  );
}
