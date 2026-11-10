import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "@/components/workbench/workbench.css";
import "./decks.css";

export function DecksListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-busy aria-label="Loading decks">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="dh-bench-row dh-bench-row--skeleton dhk-row">
          <div className="dh-bench-row__body">
            <SkeletonBar width={`${52 - (row % 3) * 9}%`} height={14} />
            <SkeletonBar width={`${26 - (row % 2) * 5}%`} height={12} style={{ marginTop: 7 }} />
          </div>
          <SkeletonBar width={58} height={12} />
          <SkeletonBar width={58} height={12} />
          <SkeletonBar width={44} height={4} />
        </div>
      ))}
    </div>
  );
}

export function DecksPageSkeleton() {
  return (
    <div className="dh-bench dhk">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <div className="dh-bench-head">
            <h1 className="dh-title">Decks</h1>
          </div>
          <SkeletonBar height={40} radius={10} style={{ marginBottom: 10 }} />
          <div className="dh-bench-filters">
            <SkeletonBar width={118} height={32} radius={999} />
            <SkeletonBar width={112} height={32} radius={999} />
            <SkeletonBar width={104} height={32} radius={999} />
          </div>
        </div>
        <div className="dh-bench-list">
          <DecksListSkeleton />
        </div>
      </div>
      <aside className="dh-panel dh-panel--float dh-bench-panel" aria-hidden />
    </div>
  );
}
