import { CramDetailSkeleton } from "@/components/cram/cram-skeletons";

export default function CramPlanLoading() {
  return (
    <div className="dh-page dh-page--narrow">
      <CramDetailSkeleton />
    </div>
  );
}
