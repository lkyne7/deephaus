import type { ReactNode } from "react";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "@/components/workbench/workbench.css";
import "@/components/community/community.css";

/** Page frame for the states shown before the deck list exists. */
export function CommunityFrame({ children }: { children: ReactNode }) {
  return (
    <div className="dh-bench dh-community">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <div className="dh-bench-head">
            <h1 className="dh-title">Community</h1>
          </div>
        </div>
        <div className="dh-bench-list">{children}</div>
      </div>
      <aside className="dh-panel dh-panel--float dh-bench-panel" aria-hidden />
    </div>
  );
}

export function CommunityListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy aria-label="Loading community decks">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="dh-bench-row dh-bench-row--skeleton dh-community-row">
          <div className="dh-bench-row__body">
            <SkeletonBar width={`${44 - (row % 3) * 8}%`} height={14} />
            <SkeletonBar width={`${62 - (row % 2) * 12}%`} height={12} style={{ marginTop: 8 }} />
            <SkeletonBar width="36%" height={10} style={{ marginTop: 8 }} />
          </div>
          <SkeletonBar width={36} height={12} />
        </div>
      ))}
    </div>
  );
}

export function CommunitySkeleton() {
  return (
    <div className="dh-bench dh-community">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <div className="dh-bench-head">
            <h1 className="dh-title">Community</h1>
          </div>
          <SkeletonBar height={40} radius={10} style={{ marginBottom: 10 }} />
          <div className="dh-bench-filters">
            <SkeletonBar width={48} height={32} radius={999} />
            <SkeletonBar width={92} height={32} radius={999} />
            <SkeletonBar width={84} height={32} radius={999} />
          </div>
        </div>
        <div className="dh-bench-list">
          <CommunityListSkeleton />
        </div>
      </div>
      <aside className="dh-panel dh-panel--float dh-bench-panel" aria-hidden />
    </div>
  );
}
