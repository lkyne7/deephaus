import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { radius } from "@/lib/theme";
import type { ThemeColors, ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DashboardStats } from "@deephaus/api-client";

const FSRS_TARGET = 100;

export default function ProfileScreen() {
  const { preference, setPreference, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStats(await api.getDashboardStats());
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const email = user?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase() || "DH";
  const name = email.split("@")[0] ?? "DeepHaus user";

  const totalCards = stats
    ? stats.state_breakdown.new +
      stats.state_breakdown.learning +
      stats.state_breakdown.review +
      stats.state_breakdown.relearning
    : 0;

  const fsrsLogCount = stats?.fsrs_log_count ?? 0;
  const fsrsProgress = Math.min(fsrsLogCount, FSRS_TARGET);
  const optimizerReady = fsrsLogCount >= FSRS_TARGET;

  return (
    <View style={styles.root}>
      <PageHeader title="Profile" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={16} style={{ gap: 14 }}>
          <View style={styles.profileRow}>
            <Avatar initials={initials} size="xl" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName}>{name}</Text>
              <Text style={styles.profileEmail}>{email}</Text>
              {user?.created_at && (
                <Text style={styles.profileMeta}>
                  Member since{" "}
                  {new Date(user.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    year: "numeric",
                  })}
                </Text>
              )}
            </View>
          </View>
          <Button
            variant="secondary"
            size="md"
            pill
            label="Sign out"
            leadingIcon="logout"
            onPress={() => void signOut()}
            fullWidth
          />
        </Card>

        {loading ? (
          <ActivityIndicator color={colors.brand500} style={{ marginTop: 12 }} />
        ) : (
          stats && (
            <View style={styles.statGrid}>
              <StatTile
                icon="layers"
                color={colors.fgSecondary}
                value={String(totalCards)}
                label="Total cards"
              />
              <StatTile
                icon="fire"
                color={colors.orange600}
                value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
                label="Current streak"
              />
              <StatTile
                icon="checkCircle"
                color={colors.brand600}
                value={String(stats.reviewed_today)}
                label="Reviews today"
              />
              <StatTile
                icon="lineChart"
                color={colors.brand700}
                value={
                  stats.retention_pct != null
                    ? `${Math.round(stats.retention_pct * 100)}%`
                    : "—"
                }
                label="30-day retention"
              />
            </View>
          )
        )}

        <Card padding={16} style={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Adaptive learning</Text>
          <Text style={styles.sectionBody}>
            DeepHaus uses the FSRS-5 algorithm to schedule reviews. Once you've
            graded enough cards, the scheduler can be tuned to your memory.
          </Text>
          <ProgressBar value={fsrsProgress / FSRS_TARGET} />
          <View style={styles.fsrsRow}>
            <Text style={styles.fsrsCount}>
              <Text style={styles.fsrsCountStrong}>{fsrsLogCount}</Text>
              <Text> / {FSRS_TARGET} reviews logged</Text>
            </Text>
            <Text style={styles.fsrsRemaining}>
              {optimizerReady
                ? "Ready to optimize"
                : `${Math.max(0, FSRS_TARGET - fsrsLogCount)} more to unlock`}
            </Text>
          </View>
          <Button
            variant="secondary"
            size="md"
            pill
            label="Optimize FSRS"
            leadingIcon="equalizer"
            disabled={!optimizerReady}
            style={{ opacity: optimizerReady ? 1 : 0.7 }}
            fullWidth
          />
        </Card>

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <Text style={styles.sectionBody}>
            Choose how DeepHaus looks. Match your system or pick a fixed theme.
          </Text>
          <View style={styles.themeGrid}>
            {(
              [
                { id: "light" as ThemePreference, icon: "sun" as const, label: "Light", sub: "Crisp canvas" },
                { id: "dark" as ThemePreference, icon: "moon" as const, label: "Dark", sub: "Easy on eyes" },
                { id: "system" as ThemePreference, icon: "system" as const, label: "System", sub: "Your OS" },
              ] as const
            ).map((opt) => {
              const active = preference === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setPreference(opt.id)}
                  style={[styles.themeCell, active && styles.themeCellActive]}
                >
                  <Icon
                    name={opt.icon}
                    size={22}
                    color={active ? colors.brand600 : colors.fgSecondary}
                  />
                  <Text
                    style={[
                      styles.themeLabel,
                      active && { color: colors.brand700 },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.themeSub}>{opt.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Text style={styles.version}>DeepHaus mobile · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function StatTile({
  icon,
  color,
  value,
  label,
  sub,
}: {
  icon: "layers" | "fire" | "checkCircle" | "lineChart";
  color: string;
  value: string;
  label: string;
  sub?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Card padding={14} style={styles.statTile}>
      <Icon name={icon} size={18} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub && <Text style={styles.statSub}>{sub}</Text>}
    </Card>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    profileRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    profileName: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    profileEmail: {
      fontSize: 13,
      color: colors.fgTertiary,
      marginTop: 2,
    },
    profileMeta: {
      fontSize: 12,
      color: colors.fgQuaternary,
      marginTop: 2,
    },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    statTile: {
      width: "48%",
      flexGrow: 1,
      gap: 4,
    },
    statValue: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.4,
      marginTop: 4,
    },
    statLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
      marginTop: 2,
    },
    statSub: {
      fontSize: 11,
      color: colors.fgQuaternary,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    sectionBody: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    fsrsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    fsrsCount: {
      fontSize: 12,
      color: colors.fgTertiary,
      fontWeight: "500",
    },
    fsrsCountStrong: {
      color: colors.fgPrimary,
      fontWeight: "600",
    },
    fsrsRemaining: {
      fontSize: 12,
      color: colors.fgQuaternary,
      fontWeight: "500",
    },
    themeGrid: {
      flexDirection: "row",
      gap: 8,
    },
    themeCell: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 8,
      borderRadius: radius.xl2,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      backgroundColor: colors.bgSurface,
      alignItems: "center",
      gap: 4,
    },
    themeCellActive: {
      backgroundColor: "rgba(79,179,177,0.10)",
      borderColor: colors.brand400,
    },
    themeLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    themeSub: {
      fontSize: 11,
      color: colors.fgQuaternary,
    },
    version: {
      fontSize: 12,
      color: colors.gray400,
      textAlign: "center",
      paddingVertical: 8,
    },
  });
}
