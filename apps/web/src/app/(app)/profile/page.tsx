import { PageHeader } from "@/components/page-header";
import { ProfileView } from "@/components/profile-view";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/fsrs/stats";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";

export const dynamic = "force-dynamic";

/**
 * Derive a friendly display name and avatar initials.
 *
 * Supabase stores the email reliably; full_name / name only exist when the
 * user signs up via an identity provider or fills out a profile. Fall back to
 * the local-part of the email so the avatar is never empty.
 */
function derivePersona(
  email: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
) {
  const fullName = (metadata?.full_name as string | undefined) ?? (metadata?.name as string | undefined);
  const localPart = email?.split("@")[0] ?? "User";
  const name = fullName?.trim() || prettifyLocalPart(localPart);
  const initials = makeInitials(name, email ?? "");
  return { name, initials };
}

function prettifyLocalPart(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function makeInitials(name: string, email: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
  }
  if (tokens.length === 1 && tokens[0].length >= 2) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return (email[0] || "?").toUpperCase();
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;

  if (!user) {
    return (
      <>
        <PageHeader title="Profile" />
        <div style={{ padding: 40, color: "var(--fg-tertiary)" }}>Please sign in to view your profile.</div>
      </>
    );
  }

  const stats = await getDashboardStats(supabase, user.id);
  const { name, initials } = derivePersona(user.email, user.user_metadata);

  return (
    <>
      <PageHeader title="Profile" />
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
    </>
  );
}
