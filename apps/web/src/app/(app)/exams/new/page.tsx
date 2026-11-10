import { ExamForm } from "@/components/exams/exam-form";

type NewExamPageProps = {
  searchParams: Promise<{ deck?: string | string[] }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewExamPage({ searchParams }: NewExamPageProps) {
  const { deck } = await searchParams;
  const deckId = typeof deck === "string" && UUID.test(deck) ? deck : undefined;
  return <ExamForm deckId={deckId} />;
}
