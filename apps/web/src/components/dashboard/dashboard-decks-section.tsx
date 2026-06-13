import { DeckGrid } from "@/components/deck-grid";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { loadDashboardMetricsBundleForRequest } from "@/lib/fsrs/dashboard-metrics";
import { topDashboardDeckRows } from "@/lib/fsrs/dashboard-decks";

export async function DashboardDecksSection({ userId }: { userId: string }) {
  const metrics = await loadDashboardMetricsBundleForRequest(userId);
  const totalDecks = metrics.perDeck.length;
  const decks = topDashboardDeckRows(metrics.perDeck);

  return (
    <section>
      <DashboardSectionHeader
        title="Your decks"
        icon="ri-folder-3-line"
        count={totalDecks}
        action={totalDecks > 0 ? { kind: "link", href: "/study", label: "View all" } : undefined}
      />
      <DeckGrid decks={decks} singleRow />
    </section>
  );
}
