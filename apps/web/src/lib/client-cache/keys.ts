/** Stable SWR cache keys for app-wide data shared across routes. */
export const cacheKeys = {
  dashboardStats: "/api/stats/dashboard",
  studyDecks: "/api/study/decks",
  communityDecks: "/api/community/decks",
  deckList: "/api/decks",
  cramPlans: "/api/cram-plans",
} as const;

export type CacheKey = (typeof cacheKeys)[keyof typeof cacheKeys];

export function reviewHeatmapKey(year: number, deckId?: string | null): string {
  return `/api/stats/heatmap?year=${year}${deckId ? `&deck=${deckId}` : ""}`;
}

export function advancedStatsKey(deck: string, range: number): string {
  return `/api/stats/advanced?deck=${deck}&range=${range}`;
}

export function leaderboardKey(period: string): string {
  return `/api/stats/leaderboard?period=${period}`;
}
