import { ExamDetailSkeleton } from "@/components/exams/exam-skeletons";

export default function ExamLoading() {
  return (
    <div className="dh-page dh-page--narrow">
      <ExamDetailSkeleton />
    </div>
  );
}
