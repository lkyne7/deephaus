import { ExamListSkeleton } from "@/components/exams/exam-skeletons";

export default function ExamsLoading() {
  return (
    <div className="dh-page">
      <div className="dh-page-head">
        <h1 className="dh-title">Exams</h1>
      </div>
      <ExamListSkeleton />
    </div>
  );
}
