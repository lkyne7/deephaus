import { StudyMode } from "@/components/study-mode";

type ExamStudyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ExamStudyPage({ params }: ExamStudyPageProps) {
  const { id } = await params;
  return <StudyMode examId={id} />;
}
