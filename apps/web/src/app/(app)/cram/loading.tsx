import { CramListSkeleton } from "@/components/cram/cram-skeletons";

export default function CramLoading() {
  return (
    <div className="dh-page">
      <div className="dh-page-head">
        <h1 className="dh-title">Cram</h1>
      </div>
      <CramListSkeleton />
    </div>
  );
}
