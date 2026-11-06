import type { CramPlanAction, CramPlanDetail } from "@deephaus/api-client";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
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
import {
  ScreenHeader,
  type ScreenHeaderMenuAction,
} from "@/components/ui/screen-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { api } from "@/lib/api";
import { deckDisplayName } from "@/lib/deck-name";
import {
  cramStatusLabel,
  cramStatusTone,
  deadlineCountdown,
  formatDeadline,
  readinessPct,
} from "@/lib/cram";
import { haptics } from "@/lib/haptics";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { plainCardText } from "@/lib/card-preview";
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
  const [refreshing, setRefreshing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setError(null);
      setDetail(await offlineData.getCramPlan(planId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this plan.");
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

  async function runRename(nextName: string) {
    if (!planId) return;
    const next = nextName.trim();
    if (!next) {
      Alert.alert("Name required", "Enter a name for this plan.");
      return;
    }
    if (next === detail?.plan.name.trim()) return;
    setBusy(true);
    try {
      setDetail(await api.updateCramPlan(planId, { name: next }));
      haptics.success();
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!planId) return;
    Alert.alert("Delete plan", "This draft plan will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await api.deleteCramPlan(planId);
              goBackOrReplace("/(tabs)/study/cram");
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
        <ScreenHeader title="Cram plan" backFallback="/(tabs)/study/cram" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Cram plan" backFallback="/(tabs)/study/cram" />
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="again" size="lg" />
          <Text style={styles.errorText}>{error ?? "Plan not found."}</Text>
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
  const manageItems: ScreenHeaderMenuAction[] = [
    {
      label: "Rename",
      sfIcon: "pencil",
      disabled: busy,
      onPress: () => setRenameOpen(true),
    },
  ];
  if (plan.status === "active") {
    manageItems.push({
      label: "Pause plan",
      sfIcon: "pause.circle",
      disabled: busy,
      onPress: () => void transition("pause"),
    });
  }
  if (plan.status === "active" || plan.status === "paused") {
    manageItems.push({
      label: "Complete plan",
      sfIcon: "checkmark.circle",
      disabled: busy,
      onPress: () => void transition("complete"),
    });
  }
  manageItems.push({
    label: plan.status === "archived" ? "Unarchive plan" : "Archive plan",
    sfIcon: plan.status === "archived" ? "tray.and.arrow.up" : "archivebox",
    disabled: busy,
    onPress: () =>
      void transition(plan.status === "archived" ? "unarchive" : "archive"),
  });
  if (plan.status === "draft") {
    manageItems.push({
      label: "Delete draft",
      sfIcon: "trash",
      destructive: true,
      disabled: busy,
      onPress: confirmDelete,
    });
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={plan.name}
        backFallback="/(tabs)/study/cram"
        actions={[
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Manage plan",
            items: manageItems,
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
      >
        <Card padding={16} style={{ gap: 14 }}>
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
            <Text style={styles.readinessValue}>{readinessPct(plan.readiness)}%</Text>
            <Text style={styles.readinessLabel}>Ready now</Text>
            <ProgressBar value={plan.readiness} height={6} style={{ marginTop: 8 }} />
          </View>

          {!forecast.feasible && plan.status !== "completed" && (
            <View style={styles.warnBox}>
              <Icon name="warning" size={15} color={colors.fgSecondary} />
              <Text style={styles.warnText}>
                Your daily budget may not be enough to reach{" "}
                {Math.round(plan.target_retention * 100)}% retention by the deadline.
                Consider more minutes per day.
              </Text>
            </View>
          )}
        </Card>

        <Card style={styles.statGrid}>
          <StatBox label="Cards" value={String(plan.card_count)} first />
          <StatBox label="Items" value={String(plan.item_count)} />
          <StatBox label="Unseen" value={String(plan.counts.new)} />
          <StatBox
            label="Daily plan"
            value={`${forecast.estimated_daily_minutes || plan.daily_minutes} min`}
          />
        </Card>

        {plan.status === "draft" && (
          <>
            <Button
              variant="primary"
              size="xl"
              label={busy ? "Starting…" : "Start plan"}
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
            variant="primary"
            size="xl"
            label="Study now"
            disabled={busy || pastDeadline}
            onPress={() => router.push(`/(tabs)/study/cram/${plan.id}/session`)}
            fullWidth
          />
        )}

        {plan.status === "paused" && (
          <Button
            variant="primary"
            size="xl"
            label={busy ? "Resuming…" : "Resume plan"}
            disabled={busy || pastDeadline}
            onPress={() => void transition("resume")}
            fullWidth
          />
        )}

        {detail.items_preview.length > 0 && (
          <View style={styles.preview}>
            <Text style={styles.sectionTitle}>Cards in this plan</Text>
            {detail.items_preview.slice(0, 8).map((item) => (
              <View key={item.id} style={styles.previewRow}>
                <Text style={styles.previewFront} numberOfLines={1}>
                  {plainCardText(item.front) || "Untitled card"}
                </Text>
                {item.deck_name ? (
                  <Text style={styles.previewDeck} numberOfLines={1}>
                    {deckDisplayName(item.deck_name)}
                  </Text>
                ) : null}
              </View>
            ))}
            {plan.item_count > 8 && (
              <Text style={styles.previewMore}>
                + {plan.item_count - 8} more item{plan.item_count - 8 === 1 ? "" : "s"}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
      <TextPromptModal
        visible={renameOpen}
        title="Rename plan"
        placeholder="Plan name"
        initialValue={plan.name}
        onSubmit={(value) => void runRename(value)}
        onClose={() => setRenameOpen(false)}
      />
    </View>
  );
}

function StatBox({
  label,
  value,
  first,
}: {
  label: string;
  value: string;
  first?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStatStyles(colors), [colors]);
  return (
    <View style={[styles.box, !first && styles.boxDivider]}>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function createStatStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 12,
      paddingHorizontal: 10,
    },
    boxDivider: {
      borderLeftWidth: 1,
      borderLeftColor: colors.line,
    },
    value: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    label: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
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
      lineHeight: 20,
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
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    readinessBlock: {
      gap: 2,
    },
    readinessLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    readinessValue: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    statGrid: {
      flexDirection: "row",
    },
    warnBox: {
      flexDirection: "row",
      gap: 8,
      padding: 11,
      borderRadius: radius.xl,
      backgroundColor: colors.bgSunken,
    },
    warnText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgSecondary,
    },
    pastDeadlineText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    sectionTitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      paddingBottom: 6,
    },
    preview: {
      paddingTop: 12,
    },
    previewRow: {
      gap: 1,
      paddingVertical: 11,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    previewFront: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    previewDeck: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    previewMore: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      paddingVertical: 11,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
  });
}
