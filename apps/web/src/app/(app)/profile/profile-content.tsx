import { ProfileView } from "@/components/profile-view";
import { getCachedDashboardStats } from "@/lib/fsrs/cached-stats";
import { getAuthUser } from "@/lib/data/server-auth";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";
import { deriveUserPersona } from "@/lib/user/display-name";

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export async function ProfileContent() {
  const user = await getAuthUser();

  if (!user) {
    return (
      <div style={{ padding: 40, color: "var(--fg-tertiary)" }}>Please sign in to view your profile.</div>
    );
  }

  const [stats, { name, initials }] = await Promise.all([
    getCachedDashboardStats(user.id),
    Promise.resolve(deriveUserPersona(user)),
  ]);

  return (
    <ProfileView
      user={{
        name,
        email: user.email ?? "—",
        initials,
        memberSince: formatMonthYear(user.created_at),
      }}
      stats={{
        totalCards: stats.total_cards,
        streak: stats.streak,
        reviewedToday: stats.reviewed_today,
        retentionPct: stats.retention_pct,
        dueNow: stats.due_now,
        newTodayRemaining: stats.new_today_remaining,
        lastOptimizedAt: stats.last_optimized_at,
        fsrsLogCount: stats.fsrs_log_count,
      }}
      optimizerMinLogs={OPTIMIZER_MIN_LOGS}
    />
  );
}
