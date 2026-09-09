import type {
  CramPlanAction,
  CramPlanDetail,
  CramPlanListItem,
  CramPlanStatus,
} from "@deephaus/api-client";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
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
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { showActionSheet, type ActionSheetOption } from "@/lib/action-sheet";
import {
  compareCramPlansByDefault,
  cramStatusLabel,
  cramStatusTone,
  deadlineCountdown,
  readinessPct,
} from "@/lib/cram";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function CramPlansScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const [plans, setPlans] = useState<CramPlanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CramPlanStatus>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamePlan, setRenamePlan] = useState<CramPlanListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const { plans: items } = await offlineData.listCramPlans();
      setPlans(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Cram Plans.");
      setPlans([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = navigation.addListener("focus", () => {
      void load();
    });
    return unsub;
  }, [navigation, load]);

  const visible = useMemo(
    () =>
      plans
        .filter((plan) => statusFilter === "all" || plan.status === statusFilter)
        .slice()
        .sort(compareCramPlansByDefault),
    [plans, statusFilter],
  );

  const applyDetail = useCallback((planId: string, next: CramPlanDetail) => {
    setPlans((prev) =>
      prev.map((plan) =>
        plan.id === planId ? { ...plan, ...next.plan, forecast: next.forecast } : plan,
      ),
    );
  }, []);

  async function runRename(plan: CramPlanListItem, nextName: string) {
    const next = nextName.trim();
    if (!next) {
      Alert.alert("Name required", "Enter a name for this Cram Plan.");
      return;
    }
    if (next === plan.name.trim()) {
      setRenamePlan(null);
      return;
    }
    setBusyId(plan.id);
    try {
      applyDetail(plan.id, await api.updateCramPlan(plan.id, { name: next }));
      haptics.success();
      setRenamePlan(null);
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
  }

  function promptRename(plan: CramPlanListItem) {
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Rename Cram Plan",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (value?: string) => {
              void runRename(plan, value ?? "");
            },
          },
        ],
        "plain-text",
        plan.name,
      );
      return;
    }
    setRenameValue(plan.name);
    setRenamePlan(plan);
  }

  async function transition(plan: CramPlanListItem, action: CramPlanAction) {
    if (busyId) return;
    setBusyId(plan.id);
    try {
      applyDetail(plan.id, await api.transitionCramPlan(plan.id, action));
      haptics.success();
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(plan: CramPlanListItem) {
    Alert.alert("Delete plan", "This draft Cram Plan will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyId(plan.id);
            try {
              await api.deleteCramPlan(plan.id);
              setPlans((prev) => prev.filter((item) => item.id !== plan.id));
              haptics.success();
            } catch (e) {
              Alert.alert(
                "Delete failed",
                e instanceof Error ? e.message : "Unknown error",
              );
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }

  function openPlanActions(plan: CramPlanListItem) {
    haptics.light();
    const pastDeadline = new Date(plan.deadline_at).getTime() <= Date.now();
    const options: ActionSheetOption[] = [
      {
        label: "Rename",
        onPress: () => promptRename(plan),
      },
    ];
    if (plan.status === "draft") {
      options.push({
        label: "Start plan",
        disabled: pastDeadline,
        onPress: () => void transition(plan, "start"),
      });
    }
    if (plan.status === "active") {
      options.push({
        label: "Study now",
        disabled: pastDeadline,
        onPress: () => router.push(`/(tabs)/study/cram/${plan.id}/session`),
      });
      options.push({
        label: "Pause plan",
        onPress: () => void transition(plan, "pause"),
      });
    }
    if (plan.status === "paused") {
      options.push({
        label: "Resume plan",
        disabled: pastDeadline,
        onPress: () => void transition(plan, "resume"),
      });
    }
    if (plan.status === "active" || plan.status === "paused") {
      options.push({
        label: "Complete plan",
        onPress: () => void transition(plan, "complete"),
      });
    }
    options.push({
      label: plan.status === "archived" ? "Unarchive plan" : "Archive plan",
      onPress: () =>
        void transition(plan, plan.status === "archived" ? "unarchive" : "archive"),
    });
    if (plan.status === "draft") {
      options.push({
        label: "Delete draft",
        destructive: true,
        onPress: () => confirmDelete(plan),
      });
    }
    showActionSheet(plan.name, undefined, options);
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Cram"
        backFallback="/(tabs)/study"
        actions={[
          {
            type: "menu",
            icon: "filter",
            sfIcon: "line.3.horizontal.decrease",
            label: "Filter plans",
            items: [
              {
                label: "All statuses",
                sfIcon: "square.grid.2x2",
                selected: statusFilter === "all",
                onPress: () => setStatusFilter("all"),
              },
              {
                label: "Active",
                sfIcon: "bolt",
                selected: statusFilter === "active",
                onPress: () => setStatusFilter("active"),
              },
              {
                label: "Draft",
                sfIcon: "pencil",
                selected: statusFilter === "draft",
                onPress: () => setStatusFilter("draft"),
              },
              {
                label: "Paused",
                sfIcon: "pause.circle",
                selected: statusFilter === "paused",
                onPress: () => setStatusFilter("paused"),
              },
              {
                label: "Completed",
                sfIcon: "checkmark.circle",
                selected: statusFilter === "completed",
                onPress: () => setStatusFilter("completed"),
              },
              {
                label: "Archived",
                sfIcon: "archivebox",
                selected: statusFilter === "archived",
                onPress: () => setStatusFilter("archived"),
              },
            ],
          },
          {
            icon: "add",
            sfIcon: "plus",
            label: "New Cram Plan",
            onPress: () => router.push("/(tabs)/study/cram/create"),
          },
        ]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.brand500}
            />
          }
        >
          {error && (
            <Card padding={16} style={styles.empty}>
              <FeaturedIcon icon="warning" variant="orange" size="md" />
              <Text style={styles.emptyTitle}>Could not load plans</Text>
              <Text style={styles.emptyBody}>{error}</Text>
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
            </Card>
          )}

          {!error && visible.length === 0 && (
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon
                icon={statusFilter === "all" ? "calendar" : "search"}
                variant={statusFilter === "all" ? "brand" : "gray"}
                size="lg"
              />
              <Text style={styles.emptyTitle}>
                {statusFilter === "all" ? "No Cram Plans yet" : "No matching plans"}
              </Text>
              <Text style={styles.emptyBody}>
                {statusFilter === "all"
                  ? "Set a deadline, pick your decks, and get a daily study plan that gets you exam-ready in time."
                  : `No ${cramStatusLabel(statusFilter).toLowerCase()} plans to show.`}
              </Text>
              {statusFilter === "all" ? (
                <Button
                  variant="brand"
                  size="md"
                  label="Create a Cram Plan"
                  leadingIcon="add"
                  onPress={() => router.push("/(tabs)/study/cram/create")}
                  style={{ marginTop: 12 }}
                />
              ) : null}
            </Card>
          )}

          {visible.map((plan) => (
            <Pressable
              key={plan.id}
              onPress={() => router.push(`/(tabs)/study/cram/${plan.id}`)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            >
              <Card padding={14} style={{ gap: 10 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={1}>
                    {plan.name}
                  </Text>
                  <BadgePill
                    label={cramStatusLabel(plan.status)}
                    tone={cramStatusTone(plan.status)}
                    showDot
                  />
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      openPlanActions(plan);
                    }}
                    hitSlop={8}
                    disabled={busyId === plan.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Actions for ${plan.name}`}
                    style={styles.moreBtn}
                  >
                    {busyId === plan.id ? (
                      <ActivityIndicator size="small" color={colors.brand500} />
                    ) : (
                      <Icon name="more" size={18} color={colors.fgQuaternary} />
                    )}
                  </Pressable>
                </View>
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Icon name="clock" size={13} color={colors.fgQuaternary} />
                    <Text style={styles.metaText}>{deadlineCountdown(plan.deadline_at)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Icon name="layers" size={13} color={colors.fgQuaternary} />
                    <Text style={styles.metaText}>{plan.item_count} items</Text>
                  </View>
                </View>
                <View style={styles.readinessRow}>
                  <ProgressBar value={plan.readiness} height={6} style={{ flex: 1 }} />
                  <Text style={styles.readinessText}>{readinessPct(plan.readiness)}% ready</Text>
                </View>
              </Card>
            </Pressable>
          ))}

        </ScrollView>
      )}
      <Modal
        visible={renamePlan != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenamePlan(null)}
      >
        <Pressable style={styles.renameBackdrop} onPress={() => setRenamePlan(null)}>
          <Pressable style={styles.renameCard} onPress={() => undefined}>
            <Text style={styles.renameTitle}>Rename Cram Plan</Text>
            <Field
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (renamePlan) void runRename(renamePlan, renameValue);
              }}
            />
            <View style={styles.renameActions}>
              <Button
                variant="secondary"
                size="md"
                label="Cancel"
                onPress={() => setRenamePlan(null)}
                style={{ flex: 1 }}
              />
              <Button
                variant="brand"
                size="md"
                label={busyId === renamePlan?.id ? "Saving…" : "Save"}
                disabled={busyId != null || !renameValue.trim()}
                onPress={() => {
                  if (renamePlan) void runRename(renamePlan, renameValue);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { padding: 16, gap: 10, paddingBottom: 32 },
    empty: { alignItems: "center", gap: 4 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.1,
    },
    moreBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -4,
    },
    renameBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 24,
    },
    renameTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    renameCard: {
      backgroundColor: colors.bgSurface,
      borderRadius: 16,
      padding: 16,
      gap: 12,
    },
    renameActions: {
      flexDirection: "row",
      gap: 8,
    },
    metaRow: {
      flexDirection: "row",
      gap: 14,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    metaText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    readinessRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    readinessText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
  });
}
