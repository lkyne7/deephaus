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
import { Field } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { radius } from "@/lib/theme";
import type { ThemeColors, ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type {
  DashboardStats,
  FsrsSettingsResponse,
  UniversityOption,
  UserProfile,
} from "@deephaus/api-client";

const FSRS_TARGET = 100;

export default function ProfileScreen() {
  const { preference, setPreference, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [globalFsrs, setGlobalFsrs] = useState<FsrsSettingsResponse | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [universityQuery, setUniversityQuery] = useState("");
  const [selectedUniversityId, setSelectedUniversityId] = useState<string | null>(null);
  const [universityResults, setUniversityResults] = useState<UniversityOption[]>([]);
  const [universitySearchBusy, setUniversitySearchBusy] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingUniversity, setPendingUniversity] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [verifyingUniversity, setVerifyingUniversity] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [retentionPct, setRetentionPct] = useState(90);
  const [newCardsPerDay, setNewCardsPerDay] = useState(10);
  const [savedGlobalFsrs, setSavedGlobalFsrs] = useState<FsrsSettingsResponse | null>(null);
  const [savingFsrs, setSavingFsrs] = useState(false);
  const [fsrsSaveError, setFsrsSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizedAtOverride, setOptimizedAtOverride] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStats, nextFsrs, nextProfile] = await Promise.all([
        api.getDashboardStats(),
        api.getFsrsSettings(),
        api.getProfile(),
      ]);
      setStats(nextStats);
      setGlobalFsrs(nextFsrs);
      setProfile(nextProfile);
      setFullName(nextProfile.full_name);
      setUsername(nextProfile.username);
      setSchoolEmail(nextProfile.university_email ?? "");
      setUniversityQuery(nextProfile.university_name ?? "");
      setSavedGlobalFsrs(nextFsrs);
      setRetentionPct(Math.round(nextFsrs.desiredRetention * 100));
      setNewCardsPerDay(nextFsrs.newCardsPerDay);
    } catch {
      setStats(null);
      setGlobalFsrs(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = universityQuery.trim();
    if (query.length < 2 || query === profile?.university_name) {
      setUniversityResults([]);
      setUniversitySearchBusy(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setUniversitySearchBusy(true);
      try {
        const result = await api.searchUniversities(query, 6);
        if (active) setUniversityResults(result.universities);
      } catch {
        if (active) setUniversityResults([]);
      } finally {
        if (active) setUniversitySearchBusy(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [profile?.university_name, universityQuery]);

  const globalFsrsDirty =
    savedGlobalFsrs != null &&
    (Math.round(savedGlobalFsrs.desiredRetention * 100) !== retentionPct ||
      savedGlobalFsrs.newCardsPerDay !== newCardsPerDay);

  const handleSaveGlobalFsrs = useCallback(async () => {
    setSavingFsrs(true);
    setFsrsSaveError(null);
    try {
      const updated = await api.updateFsrsSettings({
        desiredRetention: retentionPct / 100,
        newCardsPerDay,
      });
      setGlobalFsrs(updated);
      setSavedGlobalFsrs(updated);
    } catch (e) {
      setFsrsSaveError(extractOptimizeError(e));
    } finally {
      setSavingFsrs(false);
    }
  }, [newCardsPerDay, retentionPct]);

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      await api.optimizeFsrs();
      setOptimizedAtOverride(new Date().toISOString());
      await load();
    } catch (e) {
      setOptimizeError(extractOptimizeError(e));
    } finally {
      setOptimizing(false);
    }
  }, [load]);

  const handleSaveProfile = useCallback(async () => {
    setSavingProfile(true);
    setProfileError(null);
    try {
      const updated = await api.updateProfile({
        full_name: fullName,
        username,
      });
      setProfile(updated);
      setFullName(updated.full_name);
      setUsername(updated.username);
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setSavingProfile(false);
    }
  }, [fullName, username]);

  const handleSendUniversityCode = useCallback(async () => {
    setVerifyingUniversity(true);
    setProfileError(null);
    try {
      const result = await api.sendUniversityVerification(
        schoolEmail.trim(),
        selectedUniversityId,
      );
      setPendingUniversity(result.university_name);
      setSelectedUniversityId(result.university_id);
      setUniversityQuery(result.university_name);
      setProfile((current) =>
        current
          ? {
              ...current,
              university_name: result.university_name,
              university_email_verified_at: null,
            }
          : current,
      );
      setVerificationCode("");
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setVerifyingUniversity(false);
    }
  }, [schoolEmail, selectedUniversityId]);

  const handleVerifyUniversity = useCallback(async () => {
    setVerifyingUniversity(true);
    setProfileError(null);
    try {
      const result = await api.verifyUniversityEmail(
        schoolEmail.trim(),
        verificationCode,
      );
      setProfile(result.profile);
      setUniversityQuery(result.profile.university_name ?? "");
      setPendingUniversity(null);
      setVerificationCode("");
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setVerifyingUniversity(false);
    }
  }, [schoolEmail, verificationCode]);

  const handleSelectUniversity = useCallback(async (university: UniversityOption) => {
    setUniversitySearchBusy(true);
    setProfileError(null);
    try {
      const updated = await api.updateProfile({ university_id: university.id });
      setProfile(updated);
      setUniversityQuery(updated.university_name ?? university.name);
      setSelectedUniversityId(university.id);
      setUniversityResults([]);
      setSchoolEmail("");
      setPendingUniversity(null);
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setUniversitySearchBusy(false);
    }
  }, []);

  const email = user?.email ?? "";
  const name = profile?.full_name || user?.user_metadata?.full_name || email.split("@")[0] || "DeepHaus user";
  const nameParts = String(name).trim().split(/\s+/).filter(Boolean);
  const initials =
    (nameParts.length > 1
      ? `${nameParts[0]?.[0] ?? ""}${nameParts[nameParts.length - 1]?.[0] ?? ""}`
      : nameParts[0]?.slice(0, 2))?.toUpperCase() || "DH";

  const totalCards = stats
    ? stats.state_breakdown.new +
      stats.state_breakdown.learning +
      stats.state_breakdown.review +
      stats.state_breakdown.relearning
    : 0;

  const fsrsLogCount = stats?.fsrs_log_count ?? 0;
  const fsrsProgress = Math.min(fsrsLogCount, FSRS_TARGET);
  const optimizerReady = fsrsLogCount >= FSRS_TARGET;
  const lastOptimizedAt = optimizedAtOverride ?? stats?.last_optimized_at ?? null;

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
            label="Sign out"
            leadingIcon="logout"
            onPress={() => void signOut()}
            fullWidth
          />
        </Card>

        <Card padding={16} style={{ gap: 14 }}>
          <Text style={styles.sectionTitle}>Profile details</Text>
          <View>
            <Text style={styles.fieldLabel}>Full name</Text>
            <Field
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your name"
              autoCapitalize="words"
              autoComplete="name"
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>Username</Text>
            <Field
              value={username}
              onChangeText={(value) =>
                setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30))
              }
              placeholder="username"
              autoCapitalize="none"
              autoComplete="username"
            />
            <Text style={styles.fieldHint}>Shown publicly as @{username || "username"}.</Text>
          </View>
          <Button
            variant="secondary"
            size="md"
            label={savingProfile ? "Saving…" : "Save profile"}
            onPress={() => void handleSaveProfile()}
            disabled={
              savingProfile ||
              fullName.trim().length === 0 ||
              username.length < 3
            }
            loading={savingProfile}
            fullWidth
          />

          <View style={styles.sectionDivider} />
          <View style={styles.verifiedRow}>
            <Text style={styles.sectionTitle}>University</Text>
            {profile?.university_email_verified_at ? (
              <Text style={styles.verifiedText}>Verified</Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.fieldLabel}>University</Text>
            <Field
              value={universityQuery}
              onChangeText={(value) => {
                setUniversityQuery(value);
                setSelectedUniversityId(null);
              }}
              placeholder="Search by university name or domain"
              autoCapitalize="words"
              autoComplete="organization"
            />
            {universitySearchBusy ? (
              <ActivityIndicator color={colors.brand500} style={styles.searchSpinner} />
            ) : null}
            {universityResults.length > 0 ? (
              <View style={styles.universityResults}>
                {universityResults.map((university) => (
                  <Pressable
                    key={university.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${university.name}`}
                    style={({ pressed }) => [
                      styles.universityOption,
                      pressed && styles.universityOptionPressed,
                    ]}
                    onPress={() => void handleSelectUniversity(university)}
                  >
                    <Text style={styles.universityOptionName}>{university.name}</Text>
                    <Text style={styles.universityOptionMeta}>
                      {university.country} · {university.domains[0]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.fieldHint}>
              Selecting a university does not verify affiliation. Use the email code below.
            </Text>
          </View>
          {profile?.university_name ? (
            <Text style={styles.schoolName}>
              {profile.university_name}
              {!profile.university_email_verified_at ? (
                <Text style={styles.unverifiedText}> · Unverified</Text>
              ) : null}
            </Text>
          ) : null}
          <View>
            <Text style={styles.fieldLabel}>University email</Text>
            <Field
              value={schoolEmail}
              onChangeText={(value) => {
                setSchoolEmail(value);
                setPendingUniversity(null);
              }}
              placeholder="you@university.edu"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>
          <Button
            variant="secondary"
            size="md"
            label={verifyingUniversity ? "Sending…" : "Send verification code"}
            onPress={() => void handleSendUniversityCode()}
            disabled={verifyingUniversity || !schoolEmail.trim()}
            loading={verifyingUniversity && !pendingUniversity}
            fullWidth
          />
          {pendingUniversity ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.sectionBody}>
                We recognized {pendingUniversity}. Enter the six-digit code sent to your email.
              </Text>
              <Field
                value={verificationCode}
                onChangeText={(value) =>
                  setVerificationCode(value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                keyboardType="number-pad"
                autoComplete="one-time-code"
              />
              <Button
                variant="primary"
                size="md"
                label={verifyingUniversity ? "Verifying…" : "Verify university"}
                onPress={() => void handleVerifyUniversity()}
                disabled={verifyingUniversity || verificationCode.length !== 6}
                loading={verifyingUniversity}
                fullWidth
              />
            </View>
          ) : null}
          {profileError ? <Text style={styles.fsrsError}>{profileError}</Text> : null}
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

        <Card padding={16} style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Global FSRS defaults</Text>
          <Text style={styles.sectionBody}>
            Default retention and new-card limits for new decks and decks that inherit global settings.
          </Text>
          <View style={{ gap: 8 }}>
            <View>
              <Text style={styles.fieldLabel}>Desired retention — {retentionPct}%</Text>
              <Field
                value={String(retentionPct)}
                onChangeText={(text) => {
                  const n = Number(text.replace(/[^\d]/g, ""));
                  if (!Number.isFinite(n)) return;
                  setRetentionPct(Math.max(70, Math.min(97, n)));
                }}
                keyboardType="number-pad"
                placeholder="90"
              />
            </View>
            <View>
              <Text style={styles.fieldLabel}>New cards per day</Text>
              <Field
                value={String(newCardsPerDay)}
                onChangeText={(text) => {
                  const n = Number(text.replace(/[^\d]/g, ""));
                  if (!Number.isFinite(n)) return;
                  setNewCardsPerDay(Math.max(0, Math.min(200, n)));
                }}
                keyboardType="number-pad"
                placeholder="10"
              />
            </View>
          </View>
          {globalFsrsDirty ? (
            <Button
              variant="brand"
              size="md"
              label={savingFsrs ? "Saving…" : "Save global defaults"}
              loading={savingFsrs}
              disabled={savingFsrs}
              onPress={() => void handleSaveGlobalFsrs()}
              fullWidth
            />
          ) : null}
          {fsrsSaveError ? <Text style={styles.fsrsError}>{fsrsSaveError}</Text> : null}
        </Card>

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
            label={optimizing ? "Optimizing…" : lastOptimizedAt ? "Re-optimize" : "Optimize FSRS"}
            leadingIcon="equalizer"
            loading={optimizing}
            disabled={!optimizerReady || optimizing}
            onPress={() => void handleOptimize()}
            style={{ opacity: optimizerReady ? 1 : 0.7 }}
            fullWidth
          />
          {optimizeError ? (
            <Text style={styles.fsrsError}>{optimizeError}</Text>
          ) : lastOptimizedAt ? (
            <Text style={styles.fsrsLastRun}>Last optimized {formatRelative(lastOptimizedAt)}</Text>
          ) : null}
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

function extractOptimizeError(e: unknown): string {
  if (e instanceof Error) {
    // ApiError carries the raw response body; surface the JSON `error` field.
    try {
      const parsed = JSON.parse(e.message) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      // not JSON — fall through to the raw message
    }
    if (e.message) return e.message;
  }
  return "Failed to optimize. Please try again.";
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
    fsrsLastRun: {
      fontSize: 12,
      color: colors.fgQuaternary,
      fontWeight: "500",
    },
    fsrsError: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.gradeAgain,
      fontWeight: "500",
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    fieldHint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.fgQuaternary,
      marginTop: 5,
    },
    sectionDivider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
      marginVertical: 2,
    },
    verifiedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    verifiedText: {
      color: colors.brand700,
      backgroundColor: colors.brand50,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
      fontSize: 12,
      fontWeight: "600",
    },
    schoolName: {
      color: colors.fgPrimary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    unverifiedText: {
      color: colors.fgQuaternary,
      fontWeight: "500",
    },
    searchSpinner: {
      position: "absolute",
      right: 14,
      top: 34,
    },
    universityResults: {
      overflow: "hidden",
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.borderPrimary,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
    },
    universityOption: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSecondary,
      gap: 2,
    },
    universityOptionPressed: {
      backgroundColor: colors.brand50,
    },
    universityOptionName: {
      color: colors.fgPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    universityOptionMeta: {
      color: colors.fgQuaternary,
      fontSize: 12,
      lineHeight: 16,
    },
    themeGrid: {
      flexDirection: "row",
      gap: 8,
    },
    themeCell: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 8,
      borderRadius: radius.lg,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      backgroundColor: colors.bgSurface,
      alignItems: "center",
      gap: 4,
    },
    themeCellActive: {
      backgroundColor: colors.brand50,
      borderColor: colors.borderBrand,
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
