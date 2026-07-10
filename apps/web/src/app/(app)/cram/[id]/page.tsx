import { CramPlanDetail } from "@/components/cram/cram-plan-detail";

type CramPlanPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CramPlanPage({ params }: CramPlanPageProps) {
  const { id } = await params;
  return <CramPlanDetail planId={id} />;
}
