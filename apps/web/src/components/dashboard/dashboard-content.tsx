import { Suspense } from "react";
import {
  CardStatePanelSkeleton,
  DecksSectionSkeleton,
} from "@/components/dashboard/dashboard-skeleton";
import { DashboardDecksSection } from "@/components/dashboard/dashboard-decks-section";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardOverviewSection } from "@/components/dashboard/dashboard-overview-section";
import { getAuthUser, getUserProjects } from "@/lib/data/server-auth";
import { getDisplayNameFromUser, welcomeGreeting } from "@/lib/user/display-name";

export async function DashboardContent({ userId }: { userId: string }) {
  const currentYear = new Date().getFullYear();
  const heatmapYears = [currentYear, currentYear - 1];

  const [user, projects] = await Promise.all([getAuthUser(), getUserProjects(userId)]);
  const welcomeTitle = user ? welcomeGreeting(getDisplayNameFromUser(user)) : "Welcome back! 👋";
  const deckOptions = projects.map((p) => ({
    id: p.id,
    title: p.deck_name || p.name,
  }));

  return (
    <DashboardLayout
      welcomeTitle={welcomeTitle}
      deckOptions={deckOptions}
      hasDecksHint={projects.length > 0}
      heatmapYears={heatmapYears}
      overview={
        <Suspense fallback={<CardStatePanelSkeleton />}>
          <DashboardOverviewSection userId={userId} />
        </Suspense>
      }
      decks={
        <Suspense fallback={<DecksSectionSkeleton />}>
          <DashboardDecksSection userId={userId} />
        </Suspense>
      }
    />
  );
}
