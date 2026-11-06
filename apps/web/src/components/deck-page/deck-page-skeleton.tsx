import { RowsSkeleton } from "@/components/deck-page/deck-cards-tab";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "./deck-page.css";

export function DeckPageSkeleton() {
  return (
    <div className="dhd">
      <div className="dhd-scroll">
        <div className="dhd-layout" aria-busy aria-label="Loading deck">
          <div className="dhd-main">
            <SkeletonBar width={64} height={13} style={{ marginBottom: 18 }} />
            <SkeletonBar width="78%" height={30} radius={8} />
            <SkeletonBar width="44%" height={13} style={{ margin: "16px 0 22px" }} />
            <SkeletonBar height={82} radius={16} />
            <div style={{ height: 66 }} />
            <RowsSkeleton rows={6} />
          </div>
          <aside className="dhd-rail">
            <div className="dhd-rail__actions">
              <SkeletonBar height={42} radius={11} />
            </div>
            <div className="dh-surface dhd-box" style={{ height: 146 }} />
            <div className="dh-surface dhd-box" style={{ height: 158 }} />
          </aside>
        </div>
      </div>
    </div>
  );
}
