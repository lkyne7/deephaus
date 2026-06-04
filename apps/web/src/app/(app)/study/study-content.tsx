import { StudyHubView } from "@/components/study-hub-view";
import { deckRowsFromPerDeck } from "@/lib/fsrs/dashboard-decks";
import { loadDashboardMetricsBundle } from "@/lib/fsrs/dashboard-metrics";

export async function StudyContent({ userId }: { userId: string }) {
  const metrics = await loadDashboardMetricsBundle(userId);
  const decks = deckRowsFromPerDeck(metrics.perDeck).sort(
    (a, b) => b.dueCount + b.newCount - (a.dueCount + a.newCount),
  );

  return <StudyHubView decks={decks} />;
}
