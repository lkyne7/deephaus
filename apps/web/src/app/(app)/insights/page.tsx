import { InsightsView } from "@/components/insights/insights-view";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const { deck } = await searchParams;
  return <InsightsView initialDeckId={deck ?? null} />;
}
