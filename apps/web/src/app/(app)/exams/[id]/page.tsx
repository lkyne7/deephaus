import { ExamDetail } from "@/components/exams/exam-detail";

type ExamPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ExamPage({ params }: ExamPageProps) {
  const { id } = await params;
  return <ExamDetail examId={id} />;
}
