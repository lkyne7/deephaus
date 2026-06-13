/** Stable SWR cache keys for app-wide data shared across routes. */
export const cacheKeys = {
  dashboardStats: "/api/stats/dashboard",
  studyDecks: "/api/study/decks",
  communityDecks: "/api/community/decks",
  deckList: "/api/decks",
} as const;

export type CacheKey = (typeof cacheKeys)[keyof typeof cacheKeys];

export function reviewHeatmapKey(year: number): string {
  return `/api/stats/heatmap?year=${year}`;
}
