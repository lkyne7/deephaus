import type { CramPlanAction, CramPlanDetail } from "@deephaus/api-client";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import {
  cramStatusLabel,
  cramStatusTone,
  deadlineCountdown,
  formatDeadline,
  readinessPct,
} from "@/lib/cram";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function CramPlanDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [detail, setDetail] = useState<CramPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setError(null);
      setDetail(await api.getCramPlan(planId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Cram Plan.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
    const unsub = navigation.addListener("focus", () => {
      void load();
    });
    return unsub;
  }, [navigation, load]);

  async function transition(action: CramPlanAction) {
    if (!planId || busy) return;
    setBusy(true);
    try {
      setDetail(await api.transitionCramPlan(planId, action));
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!planId) return;
    Alert.alert("Delete plan", "This draft Cram Plan will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await api.deleteCramPlan(planId);
              router.back();
            } catch (e) {
              Alert.alert(
                "Delete failed",
                e instanceof Error ? e.message : "Unknown error",
              );
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <PageHeader title="Cram Plan" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.root}>
        <PageHeader title="Cram Plan" onBack={() => router.back()} />
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="orange" size="lg" />
          <Text style={styles.errorText}>{error ?? "Cram Plan not found."}</Text>
          <Button
            variant="secondary"
            size="md"
            label="Try again"
            onPress={() => {
              setLoading(true);
              void load();
            }}
            style={{ marginTop: 12 }}
          />
        </View>
      </View>
    );
  }

  const { plan, forecast } = detail;
  const pastDeadline = new Date(plan.deadline_at).getTime() <= Date.now();

  return (
    <View style={styles.root}>
      <PageHeader title={plan.name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card padding={16} style={{ gap: 12 }}>
          <View style={styles.statusRow}>
            <BadgePill
              label={cramStatusLabel(plan.status)}
              tone={cramStatusTone(plan.status)}
              showDot
            />
            <Text style={styles.deadlineText}>
              {formatDeadline(plan.deadline_at, plan.deadline_timezone)} ·{" "}
              {deadlineCountdown(plan.deadline_at)}
            </Text>
          </View>

          <View style={styles.readinessBlock}>
            <View style={styles.readinessHeader}>
              <Text style={styles.readinessLabel}>Readiness</Text>
              <Text style={styles.readinessValue}>{readinessPct(plan.readiness)}%</Text>
            </View>
            <ProgressBar value={plan.readiness} height={8} />
          </View>

          <View style={styles.statGrid}>
            <StatBox label="Cards" value={String(plan.card_count)} />
            <StatBox label="Items" value={String(plan.item_count)} />
            <StatBox label="Unseen" value={String(plan.counts.new)} />
            <StatBox
              label="Daily plan"
              value={`${forecast.estimated_daily_minutes || plan.daily_minutes} min`}
            />
          </View>

          {!forecast.feasible && plan.status !== "completed" && (
            <View style={styles.warnBox}>
              <Icon name="warning" size={15} color={colors.orange700} />
              <Text style={styles.warnText}>
                Your daily budget may not be enough to reach{" "}
                {Math.round(plan.target_retention * 100)}% retention by the deadline.
                Consider more minutes per day.
              </Text>
            </View>
          )}
        </Card>

        {plan.status === "draft" && (
          <>
            <Button
              variant="brand"
              size="xl"
              label={busy ? "Starting…" : "Start plan"}
              leadingIcon="play"
              disabled={busy || pastDeadline}
              onPress={() => void transition("start")}
              fullWidth
            />
            {pastDeadline && (
              <Text style={styles.pastDeadlineText}>
                The deadline has passed, so this plan can no longer be started.
              </Text>
            )}
          </>
        )}

        {plan.status === "active" && (
          <Button
            variant="brand"
            size="xl"
            label="Study now"
            leadingIcon="book"
            disabled={busy || pastDeadline}
            onPress={() => router.push(`/(tabs)/study/cram/${plan.id}/session`)}
            fullWidth
          />
        )}

        {plan.status === "paused" && (
          <Button
            variant="brand"
            size="xl"
            label={busy ? "Resuming…" : "Resume plan"}
            leadingIcon="play"
            disabled={busy || pastDeadline}
            onPress={() => void transition("resume")}
            fullWidth
          />
        )}

        <Card padding={16} style={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Manage</Text>
          <View style={styles.manageRow}>
            {plan.status === "active" && (
              <Button
                variant="secondary"
                size="md"
                label="Pause"
                disabled={busy}
                onPress={() => void transition("pause")}
                style={{ flex: 1 }}
              />
            )}
            {(plan.status === "active" || plan.status === "paused") && (
              <Button
                variant="secondary"
                size="md"
                label="Complete"
                disabled={busy}
                onPress={() => void transition("complete")}
                style={{ flex: 1 }}
              />
            )}
            {plan.status === "archived" ? (
              <Button
                variant="secondary"
                size="md"
                label="Unarchive"
                disabled={busy}
                onPress={() => void transition("unarchive")}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                variant="secondary"
                size="md"
                label="Archive"
                disabled={busy}
                onPress={() => void transition("archive")}
                style={{ flex: 1 }}
              />
            )}
          </View>
          {plan.status === "draft" && (
            <Button
              variant="danger"
              size="md"
              label="Delete draft"
              disabled={busy}
              onPress={confirmDelete}
              fullWidth
            />
          )}
        </Card>

        {detail.items_preview.length > 0 && (
          <Card padding={16} style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Cards in this plan</Text>
            {detail.items_preview.slice(0, 8).map((item) => (
              <View key={item.id} style={styles.previewRow}>
                <Icon name="layers" size={14} color={colors.fgQuaternary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.previewFront} numberOfLines={1}>
                    {item.front || "Untitled card"}
                  </Text>
                  {item.deck_name ? (
                    <Text style={styles.previewDeck} numberOfLines={1}>
                      {item.deck_name}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            {plan.item_count > 8 && (
              <Text style={styles.previewMore}>
                + {plan.item_count - 8} more item{plan.item_count - 8 === 1 ? "" : "s"}
              </Text>
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStatStyles(colors), [colors]);
  return (
    <View style={styles.box}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function createStatStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: {
      flex: 1,
      minWidth: "22%",
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: colors.gray50,
      alignItems: "center",
    },
    value: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    label: {
      fontSize: 11,
      fontWeight: "500",
      color: colors.fgQuaternary,
      marginTop: 2,
    },
  });
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    errorText: {
      fontSize: 14,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 12,
    },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    deadlineText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    readinessBlock: {
      gap: 8,
    },
    readinessHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    readinessLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    readinessValue: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.brand700,
    },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    warnBox: {
      flexDirection: "row",
      gap: 8,
      padding: 10,
      borderRadius: 10,
      backgroundColor: colors.orange50,
    },
    warnText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 17,
      color: colors.orange700,
    },
    pastDeadlineText: {
      fontSize: 12,
      color: colors.fgQuaternary,
      textAlign: "center",
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    manageRow: {
      flexDirection: "row",
      gap: 8,
    },
    previewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    previewFront: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    previewDeck: {
      fontSize: 11,
      color: colors.fgQuaternary,
      marginTop: 1,
    },
    previewMore: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgQuaternary,
    },
  });
}
