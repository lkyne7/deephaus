import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "./cram.css";

export function CramListSkeleton() {
  return (
    <div className="cram-layout" aria-busy aria-label="Loading cram plans">
      <div className="cram-main">
        <div className="dh-surface cram-today">
          <div style={{ flex: 1 }}>
            <SkeletonBar width="42%" height={20} />
            <SkeletonBar width="30%" height={12} style={{ marginTop: 8 }} />
          </div>
          <SkeletonBar width={110} height={36} radius={9} />
        </div>
        <div className="dh-section-label">
          <SkeletonBar width={48} height={12} />
        </div>
        <div className="dh-surface">
          {[0, 1].map((row) => (
            <div key={row} className="cram-plan">
              <div>
                <SkeletonBar width="60%" height={14} />
                <SkeletonBar width="44%" height={12} style={{ marginTop: 7 }} />
              </div>
              <SkeletonBar width="100%" height={6} />
              <SkeletonBar width={64} height={12} />
              <SkeletonBar width={58} height={30} radius={8} />
            </div>
          ))}
        </div>
      </div>
      <aside>
        <div className="dh-surface cram-cal">
          <SkeletonBar width="50%" height={14} style={{ marginBottom: 14 }} />
          <SkeletonBar width="100%" height={200} radius={8} />
        </div>
      </aside>
    </div>
  );
}

export function CramCreatorSkeleton() {
  return (
    <div className="cram-form-layout" aria-busy aria-label="Loading cram plan creator">
      <div>
        <SkeletonBar width={48} height={12} style={{ marginBottom: 16 }} />
        <SkeletonBar width="62%" height={34} radius={6} style={{ marginBottom: 22 }} />
        <SkeletonBar width="100%" height={46} radius={10} style={{ marginBottom: 24 }} />
        {[0, 1, 2].map((group) => (
          <div key={group} className="cram-fgroup">
            <SkeletonBar width={120} height={14} style={{ marginBottom: 14 }} />
            <SkeletonBar width="100%" height={40} radius={10} />
          </div>
        ))}
      </div>
      <aside className="cram-form-aside">
        <div className="dh-surface dh-surface--raised cram-preview">
          <SkeletonBar width="50%" height={12} />
          <SkeletonBar width="44%" height={52} radius={8} style={{ marginTop: 10 }} />
          <SkeletonBar width="100%" height={120} radius={8} style={{ marginTop: 18 }} />
        </div>
      </aside>
    </div>
  );
}

export function CramDetailSkeleton() {
  return (
    <div aria-busy aria-label="Loading cram plan">
      <SkeletonBar width={48} height={12} style={{ marginBottom: 16 }} />
      <SkeletonBar width="48%" height={34} radius={6} />
      <SkeletonBar width="34%" height={14} style={{ margin: "12px 0 22px" }} />
      <div className="dh-surface cram-hero">
        <SkeletonBar width="24%" height={52} radius={8} />
        <SkeletonBar width="100%" height={190} radius={8} style={{ marginTop: 18 }} />
      </div>
      <div className="dh-surface cram-stats">
        {[0, 1, 2, 3].map((stat) => (
          <div key={stat}>
            <SkeletonBar width="50%" height={22} />
            <SkeletonBar width="64%" height={12} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
