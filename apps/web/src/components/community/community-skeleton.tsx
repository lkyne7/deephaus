import type { ReactNode } from "react";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "@/components/community/community.css";

/** Page frame for the states shown before the deck list exists. */
export function CommunityFrame({ children }: { children: ReactNode }) {
  return (
    <div className="dh-page">
      <div className="dh-page-head">
        <h1 className="dh-title">Community</h1>
      </div>
      {children}
    </div>
  );
}

export function CommunitySkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <CommunityFrame>
      <div className="dh-toolbar">
        <SkeletonBar height={40} radius={10} style={{ flex: 1 }} />
        <SkeletonBar width={196} height={40} radius={10} />
      </div>
      <div className="dh-section-label dh-community-first-label">Featured</div>
      <div className="dh-community-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dh-surface dh-community-card">
            <SkeletonBar width="72%" height={16} />
            <SkeletonBar width="92%" height={13} style={{ marginTop: 6 }} />
            <span className="dh-spacer" />
            <SkeletonBar width="64%" height={13} />
          </div>
        ))}
      </div>
      <div className="dh-section-label">All decks</div>
      <ul className="dh-community-list">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="dh-row dh-community-row">
            <span style={{ flex: 1, minWidth: 0 }}>
              <SkeletonBar width="38%" height={14} />
              <SkeletonBar width="52%" height={12} style={{ marginTop: 8 }} />
            </span>
            <SkeletonBar width={84} height={30} radius={8} />
          </li>
        ))}
      </ul>
    </CommunityFrame>
  );
}
