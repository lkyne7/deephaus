"use client";

import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import { useTheme, type Theme } from "@/components/theme-provider";
import { ProfileDisplayNameForm } from "@/components/profile-display-name-form";

export interface ProfileViewProps {
  user: {
    name: string;
    email: string;
    initials: string;
    memberSince: string;
  };
  stats: {
    totalCards: number;
    streak: number;
    reviewedToday: number;
    retentionPct: number | null;
    dueNow: number;
    newTodayRemaining: number;
    lastOptimizedAt: string | null;
    fsrsLogCount: number;
  };
  optimizerMinLogs: number;
}

export function ProfileView({ user, stats, optimizerMinLogs }: ProfileViewProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [lastOptimizedAt, setLastOptimizedAt] = useState(stats.lastOptimizedAt);

  const optimizerReady = stats.fsrsLogCount >= optimizerMinLogs;
  const optimizerProgress = Math.min(stats.fsrsLogCount / optimizerMinLogs, 1);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleOptimize() {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await fetch("/api/fsrs/optimize", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to optimize");
      setLastOptimizedAt(new Date().toISOString());
      router.refresh();
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : "Failed to optimize");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <FadeIn style={s.page}>
      {/* Account header card */}
      <section style={s.card}>
        <div style={s.accountRow}>
          <div style={s.avatar}>{user.initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={s.accountName}>{user.name}</h2>
            <p style={s.accountMeta}>{user.email}</p>
            <p style={s.accountSub}>Member since {user.memberSince}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="btn btn-ghost btn-sm"
          >
            <i className="ri-logout-box-r-line" />
            {signingOut ? "Signing out…" : "Sign Out"}
          </button>
        </div>
        <ProfileDisplayNameForm initialName={user.name} />
      </section>

      {/* Stats grid */}
      <StaggerList style={s.statsGrid}>
        <StaggerItem>
          <StatTile
            label="Total cards"
            value={stats.totalCards.toLocaleString()}
            icon="ri-stack-line"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Current streak"
            value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
            icon="ri-fire-line"
            iconColor="var(--orange-500)"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Reviews today"
            value={stats.reviewedToday.toLocaleString()}
            icon="ri-checkbox-circle-line"
            iconColor="var(--brand-500)"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="30-day retention"
            value={stats.retentionPct === null ? "—" : `${Math.round(stats.retentionPct * 100)}%`}
            icon="ri-line-chart-line"
            iconColor="var(--brand-700)"
            hint={stats.retentionPct === null ? "Not enough data yet" : undefined}
          />
        </StaggerItem>
      </StaggerList>

      {/* Adaptive learning / FSRS */}
      <section style={s.card}>
        <div style={s.sectionHead}>
          <div>
            <h2 style={s.sectionTitle}>Adaptive learning</h2>
            <p style={s.sectionSub}>
              DeepHaus uses the FSRS-5 algorithm to decide when to show each card. Once you've
              graded enough cards, you can fit personal scheduler parameters to your own
              memory.
            </p>
          </div>
        </div>

        <div style={s.fsrsRow}>
          <div style={s.fsrsMeter}>
            <div style={s.fsrsMeterTrack}>
              <m.div
                style={{
                  ...s.fsrsMeterFill,
                  background: optimizerReady ? "var(--brand-500)" : "var(--gray-400)",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${optimizerProgress * 100}%` }}
                transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
              />
            </div>
            <div style={s.fsrsMeterLabels}>
              <span>
                <strong style={{ color: "var(--fg-primary)" }}>
                  {stats.fsrsLogCount.toLocaleString()}
                </strong>{" "}
                / {optimizerMinLogs.toLocaleString()} reviews logged
              </span>
              <span>
                {optimizerReady
                  ? "Ready to optimize"
                  : `${optimizerMinLogs - stats.fsrsLogCount} more to unlock`}
              </span>
            </div>
            {lastOptimizedAt && (
              <p style={s.fsrsLastRun}>
                Last optimized {formatDate(lastOptimizedAt)} ({formatRelative(lastOptimizedAt)})
              </p>
            )}
            {optimizeError && (
              <p
                style={{
                  font: "500 13px/18px var(--font-sans)",
                  color: "var(--grade-again)",
                  marginTop: 8,
                }}
              >
                {optimizeError}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!optimizerReady || optimizing}
            className="btn btn-primary"
            title={
              optimizerReady
                ? "Fit FSRS parameters to your review history"
                : `Need at least ${optimizerMinLogs} reviews to optimize`
            }
          >
            <i className="ri-equalizer-line" />
            {optimizing
              ? "Optimizing…"
              : lastOptimizedAt
                ? "Re-optimize"
                : "Optimize FSRS"}
          </button>
        </div>
      </section>

      {/* Appearance */}
      <section style={s.card}>
        <div style={s.sectionHead}>
          <div>
            <h2 style={s.sectionTitle}>Appearance</h2>
            <p style={s.sectionSub}>
              Choose how DeepHaus looks. Match your system or pick a fixed theme.
            </p>
          </div>
        </div>

        <div style={s.themeRow}>
          {THEMES.map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTheme(opt.id)}
                style={{
                  ...s.themeCard,
                  borderColor: active ? "var(--brand-500)" : "var(--border-secondary)",
                  background: active ? "var(--brand-50)" : "var(--bg-surface)",
                  color: active ? "var(--brand-800)" : "var(--fg-primary)",
                  boxShadow: active ? "0 0 0 4px rgba(49, 151, 149, 0.16)" : "none",
                }}
              >
                <i className={opt.icon} style={s.themeIcon} />
                <span style={{ font: "600 14px/20px var(--font-sans)" }}>{opt.label}</span>
                <span style={s.themeHint}>{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </section>
    </FadeIn>
  );
}

const THEMES: Array<{ id: Theme; label: string; hint: string; icon: string }> = [
  { id: "light", label: "Light", hint: "Crisp white canvas", icon: "ri-sun-line" },
  { id: "dark", label: "Dark", hint: "Easy on the eyes", icon: "ri-moon-line" },
  { id: "system", label: "System", hint: "Follow your OS", icon: "ri-computer-line" },
];

function StatTile({
  label,
  value,
  icon,
  iconColor,
  hint,
}: {
  label: string;
  value: string;
  icon: string;
  iconColor?: string;
  hint?: string;
}) {
  return (
    <div style={s.statTile}>
      <div
        style={{
          ...s.statIcon,
          color: iconColor ?? "var(--fg-tertiary)",
        }}
      >
        <i className={icon} />
      </div>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
      {hint && <div style={s.statHint}>{hint}</div>}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const months = Math.floor(day / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: "32px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 960,
    width: "100%",
  },
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 16,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  accountRow: {
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "var(--brand-500)",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 24px/1 var(--font-sans)",
    flexShrink: 0,
    boxShadow: "var(--shadow-xs)",
  },
  accountName: {
    font: "600 22px/28px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  accountMeta: {
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
  },
  accountSub: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-quaternary)",
    margin: "2px 0 0",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  statTile: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 12,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 132,
  },
  statIcon: {
    fontSize: 22,
    lineHeight: 1,
    marginBottom: 8,
  },
  statValue: {
    font: "600 28px/1.1 var(--font-sans)",
    color: "var(--fg-primary)",
    letterSpacing: "-0.02em",
  },
  statLabel: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
    marginTop: 4,
  },
  statHint: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
    marginTop: 2,
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  sectionTitle: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
  },
  sectionSub: {
    font: "400 14px/22px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 560,
  },
  fsrsRow: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    flexWrap: "wrap",
  },
  fsrsMeter: { flex: 1, minWidth: 240 },
  fsrsMeterTrack: {
    height: 8,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-tertiary)",
    borderRadius: 9999,
    overflow: "hidden",
  },
  fsrsMeterFill: {
    height: "100%",
    transition: "width 240ms ease",
  },
  fsrsMeterLabels: {
    display: "flex",
    justifyContent: "space-between",
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-tertiary)",
    marginTop: 8,
    gap: 12,
  },
  fsrsLastRun: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
    margin: "8px 0 0",
  },
  themeRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  themeCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: "18px 20px",
    border: "1px solid var(--border-secondary)",
    borderRadius: 12,
    background: "var(--bg-surface)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
  },
  themeIcon: {
    fontSize: 22,
    marginBottom: 8,
    color: "inherit",
  },
  themeHint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
};
