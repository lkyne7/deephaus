/** Next.js cache tags for per-user dashboard / study data. */
export function dashboardStatsTag(userId: string): string {
  return `dashboard-stats:${userId}`;
}

export function studyDecksTag(userId: string): string {
  return `study-decks:${userId}`;
}
