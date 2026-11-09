import { SkeletonBar } from "@/components/ui/skeleton-bars";
import "./exams.css";

export function ExamListSkeleton() {
  return (
    <div className="exam-main" aria-busy aria-label="Loading exams">
      <div className="dh-section-label">
        <SkeletonBar width={64} height={12} />
      </div>
      <div className="dh-surface">
        {[0, 1].map((row) => (
          <div key={row} className="exam-row">
            <div>
              <SkeletonBar width="52%" height={14} />
              <SkeletonBar width="38%" height={12} style={{ marginTop: 7 }} />
            </div>
            <div>
              <SkeletonBar width="100%" height={12} />
              <SkeletonBar width="100%" height={6} style={{ marginTop: 8 }} />
            </div>
            <SkeletonBar width={150} height={30} radius={8} style={{ justifySelf: "end" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExamFormSkeleton() {
  return (
    <div className="exam-form-layout" aria-busy aria-label="Loading the exam form">
      <div>
        <SkeletonBar width={48} height={12} style={{ marginBottom: 16 }} />
        <SkeletonBar width="46%" height={34} radius={6} style={{ marginBottom: 22 }} />
        <SkeletonBar width="100%" height={46} radius={10} style={{ marginBottom: 24 }} />
        {[0, 1, 2, 3].map((group) => (
          <div key={group} className="exam-fgroup">
            <SkeletonBar width={120} height={14} style={{ marginBottom: 14 }} />
            <SkeletonBar width="100%" height={40} radius={10} />
          </div>
        ))}
      </div>
      <aside className="exam-form-aside">
        <div className="dh-surface dh-surface--raised exam-preview">
          <SkeletonBar width="40%" height={12} />
          <SkeletonBar width="44%" height={52} radius={8} style={{ marginTop: 10 }} />
          <SkeletonBar width="100%" height={150} radius={8} style={{ marginTop: 18 }} />
        </div>
      </aside>
    </div>
  );
}

export function ExamDetailSkeleton() {
  return (
    <div aria-busy aria-label="Loading exam">
      <SkeletonBar width={48} height={12} style={{ marginBottom: 16 }} />
      <SkeletonBar width="48%" height={34} radius={6} />
      <SkeletonBar width="34%" height={14} style={{ margin: "12px 0 22px" }} />
      <div className="dh-surface exam-hero">
        <div className="exam-hero__numbers">
          <SkeletonBar width={110} height={52} radius={8} />
          <SkeletonBar width={110} height={52} radius={8} />
          <div style={{ flex: 1 }}>
            <SkeletonBar width="70%" height={18} />
            <SkeletonBar width="90%" height={12} style={{ marginTop: 10 }} />
          </div>
        </div>
      </div>
      <div className="dh-surface exam-session">
        <div style={{ flex: 1 }}>
          <SkeletonBar width="30%" height={20} />
          <SkeletonBar width="22%" height={12} style={{ marginTop: 8 }} />
        </div>
        <SkeletonBar width={104} height={36} radius={9} />
      </div>
      <div className="dh-surface exam-stats">
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
