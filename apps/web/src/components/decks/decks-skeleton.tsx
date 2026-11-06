import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "./decks.css";

export function DecksBodySkeleton({ view = "grid" }: { view?: "table" | "grid" }) {
  if (view === "table") {
    return (
      <div className="dhk-rows" aria-busy aria-label="Loading decks">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="dh-row dhk-row">
            <div className="dhk-row__main">
              <SkeletonBar width="46%" height={14} />
              <SkeletonBar width="24%" height={12} style={{ marginTop: 7 }} />
            </div>
            <SkeletonBar width={58} height={12} />
            <SkeletonBar width={58} height={12} />
            <SkeletonBar width={58} height={30} radius={8} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="dhk-grid" aria-busy aria-label="Loading decks">
      {[0, 1, 2, 3, 4, 5].map((card) => (
        <div key={card} className="dhk-card">
          <SkeletonBar width="72%" height={15} />
          <SkeletonBar width="56%" height={12} style={{ marginTop: 6 }} />
          <span className="dh-spacer" />
          <SkeletonBar width={64} height={12} />
        </div>
      ))}
    </div>
  );
}

export function DecksPageSkeleton() {
  return (
    <div className="dh-page dhk">
      <div className="dh-page-head">
        <h1 className="dh-title">Decks</h1>
      </div>
      <div className="dh-toolbar">
        <SkeletonBar height={40} radius={10} />
      </div>
      <DecksBodySkeleton />
    </div>
  );
}
