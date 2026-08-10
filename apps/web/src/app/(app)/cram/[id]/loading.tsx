import { SkeletonBar } from "@/components/ui/skeleton-bars";

export default function CramPlanLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }} aria-busy aria-label="Loading cram plan">
      <div className="cram-panel" style={{ height: 120 }} />
      <div className="cram-panel" style={{ height: 220, padding: 20 }}>
        <SkeletonBar width="40%" height={16} style={{ marginBottom: 14 }} />
        <SkeletonBar width="100%" height={12} />
        <SkeletonBar width="92%" height={12} style={{ marginTop: 8 }} />
        <SkeletonBar width="60%" height={12} style={{ marginTop: 8 }} />
      </div>
      <div className="cram-panel" style={{ height: 220, padding: 20 }}>
        <SkeletonBar width="34%" height={16} style={{ marginBottom: 14 }} />
        <SkeletonBar width="100%" height={12} />
        <SkeletonBar width="84%" height={12} style={{ marginTop: 8 }} />
      </div>
    </div>
  );
}
