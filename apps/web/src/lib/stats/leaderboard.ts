export const LEADERBOARD_PERIODS = ["week", "month", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export type LeaderboardRpcRow = {
  user_id: string;
  username: string;
  review_count: number;
  rank: number;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  reviews: number;
  isMe: boolean;
};

export type LeaderboardData = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  /** Caller's own standing; null when they have no reviews in the period. */
  me: { rank: number; reviews: number } | null;
};

export function periodStartFor(period: LeaderboardPeriod): Date | null {
  if (period === "all") return null;
  const start = new Date();
  start.setDate(start.getDate() - (period === "week" ? 7 : 30));
  return start;
}

/** Shapes raw RPC rows into a minimal public leaderboard payload. */
export function buildLeaderboard(
  rows: LeaderboardRpcRow[],
  currentUserId: string,
  period: LeaderboardPeriod,
  maxRows: number,
): LeaderboardData {
  const all = rows.map((row) => ({
    rank: Number(row.rank),
    username: row.username,
    reviews: Number(row.review_count),
    isMe: row.user_id === currentUserId,
  }));

  const meRow = all.find((entry) => entry.isMe) ?? null;
  return {
    period,
    entries: all.slice(0, maxRows),
    me: meRow ? { rank: meRow.rank, reviews: meRow.reviews } : null,
  };
}
