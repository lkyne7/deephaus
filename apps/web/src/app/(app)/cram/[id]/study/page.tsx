import { CramStudyMode } from "@/components/cram/cram-study-mode";

type CramStudyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CramStudyPage({ params }: CramStudyPageProps) {
  const { id } = await params;
  return <CramStudyMode planId={id} />;
}
