import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "@/components/workbench/workbench.css";
import "./cards.css";

export function CardsListSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="dh-bench-row dh-bench-row--skeleton">
          <div className="dh-bench-row__body">
            <SkeletonBar width={`${64 - (row % 3) * 10}%`} height={13} />
            <SkeletonBar width={`${38 - (row % 2) * 8}%`} height={11} style={{ marginTop: 8 }} />
            <SkeletonBar width="26%" height={9} style={{ marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardsPageSkeleton() {
  return (
    <div className="dh-bench dh-cards">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <h1 className="dh-title dh-bench-title">Cards</h1>
          <SkeletonBar height={40} radius={10} style={{ marginBottom: 10 }} />
          <div className="dh-bench-filters">
            <SkeletonBar width={124} height={32} radius={999} />
            <SkeletonBar width={114} height={32} radius={999} />
            <SkeletonBar width={104} height={32} radius={999} />
          </div>
        </div>
        <div className="dh-bench-list">
          <CardsListSkeleton />
        </div>
      </div>
      <aside className="dh-panel dh-panel--float dh-bench-panel dh-cards-panel" aria-hidden />
    </div>
  );
}
