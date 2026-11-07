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
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { Icon } from "@/components/ui/icon";
import type { NativeMenuItem } from "@/components/ui/menu-sheet";
import { NativeContextMenu, NativeMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { api } from "@/lib/api";
import {
  compareCramPlansByDefault,
  cramStatusLabel,
  cramStatusTone,
  deadlineCountdown,
  readinessPct,
} from "@/lib/cram";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const STATUS_ORDER: CramPlanStatus[] = ["active", "draft", "paused", "completed", "archived"];

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

  const load = useCallback(async () => {
    try {
      setError(null);
      const { plans: items } = await offlineData.listCramPlans();
      setPlans(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your plans.");
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

  const filterOptions = useMemo(
    () => [
      { value: "all" as const, label: "All", count: plans.length },
      ...STATUS_ORDER.map((status) => ({
        value: status,
        label: cramStatusLabel(status),
        count: plans.filter((plan) => plan.status === status).length,
      })),
    ],
    [plans],
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
      Alert.alert("Name required", "Enter a name for this plan.");
      return;
    }
    if (next === plan.name.trim()) return;
    setBusyId(plan.id);
    try {
      applyDetail(plan.id, await api.updateCramPlan(plan.id, { name: next }));
      haptics.success();
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusyId(null);
    }
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
    Alert.alert("Delete plan", "This draft plan will be permanently deleted.", [
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

  function planMenu(plan: CramPlanListItem): NativeMenuItem[] {
    const pastDeadline = new Date(plan.deadline_at).getTime() <= Date.now();
    const items: NativeMenuItem[] = [
      {
        label: "Rename",
        sfIcon: "pencil",
        onPress: () => setRenamePlan(plan),
      },
    ];
    if (plan.status === "draft") {
      items.push({
        label: "Start plan",
        sfIcon: "play",
        disabled: pastDeadline,
        onPress: () => void transition(plan, "start"),
      });
    }
    if (plan.status === "active") {
      items.push({
        label: "Study now",
        sfIcon: "book",
        disabled: pastDeadline,
        onPress: () => router.push(`/study/cram/${plan.id}`),
      });
      items.push({
        label: "Pause plan",
        sfIcon: "pause.circle",
        onPress: () => void transition(plan, "pause"),
      });
    }
    if (plan.status === "paused") {
      items.push({
        label: "Resume plan",
        sfIcon: "play",
        disabled: pastDeadline,
        onPress: () => void transition(plan, "resume"),
      });
    }
    if (plan.status === "active" || plan.status === "paused") {
      items.push({
        label: "Complete plan",
        sfIcon: "checkmark.circle",
        onPress: () => void transition(plan, "complete"),
      });
    }
    items.push({
      label: plan.status === "archived" ? "Unarchive plan" : "Archive plan",
      sfIcon: plan.status === "archived" ? "tray.and.arrow.up" : "archivebox",
      onPress: () =>
        void transition(plan, plan.status === "archived" ? "unarchive" : "archive"),
    });
    if (plan.status === "draft") {
      items.push({
        label: "Delete draft",
        sfIcon: "trash",
        destructive: true,
        onPress: () => confirmDelete(plan),
      });
    }
    return items.map((item) => ({ ...item, disabled: item.disabled || busyId != null }));
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        sidebar
        title="Cram"
        actions={[
          {
            icon: "add",
            sfIcon: "plus",
            label: "New cram plan",
            onPress: () => router.push("/cram/create"),
          },
        ]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
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
              tintColor={colors.accent}
            />
          }
        >
          {!error && plans.length > 0 && (
            <FilterPills
              accessibilityLabel="Filter plans by status"
              options={filterOptions}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          )}

          {error && (
            <View style={styles.empty}>
              <FeaturedIcon icon="warning" variant="again" size="md" />
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
            </View>
          )}

          {!error && plans.length === 0 && (
            <View style={styles.empty}>
              <FeaturedIcon icon="calendar" variant="brand" size="lg" />
              <Text style={styles.emptyTitle}>No cram plans yet</Text>
              <Text style={styles.emptyBody}>
                Set a deadline, pick your decks, and get a daily study plan that gets you
                exam-ready in time.
              </Text>
              <Button
                variant="primary"
                size="md"
                label="New plan"
                leadingIcon="add"
                onPress={() => router.push("/cram/create")}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          {plans.length > 0 && visible.length === 0 && statusFilter !== "all" && (
            <View style={styles.empty}>
              <FeaturedIcon icon="search" variant="gray" size="lg" />
              <Text style={styles.emptyTitle}>No matching plans</Text>
              <Text style={styles.emptyBody}>
                No {cramStatusLabel(statusFilter).toLowerCase()} plans to show.
              </Text>
            </View>
          )}

          {visible.length > 0 && (
            <View style={styles.list}>
              {visible.map((plan) => {
                const menu = planMenu(plan);
                return (
                  <NativeContextMenu key={plan.id} label={plan.name} entries={menu}>
                    {({ onLongPress }) => (
                      <View style={styles.plan}>
                        <Pressable
                          onPress={() => router.push(`/cram/${plan.id}`)}
                          onLongPress={onLongPress}
                          accessibilityRole="button"
                          style={({ pressed }) => [styles.planBody, pressed && { opacity: 0.6 }]}
                        >
                          <View style={styles.titleRow}>
                            <Text style={styles.title} numberOfLines={1}>
                              {plan.name}
                            </Text>
                            <BadgePill
                              label={cramStatusLabel(plan.status)}
                              tone={cramStatusTone(plan.status)}
                              showDot
                            />
                          </View>
                          <Text style={styles.metaText} numberOfLines={1}>
                            {plan.item_count} items · {deadlineCountdown(plan.deadline_at)}
                          </Text>
                          <View style={styles.readinessRow}>
                            <ProgressBar value={plan.readiness} style={{ flex: 1 }} />
                            <Text style={styles.readinessText}>
                              {readinessPct(plan.readiness)}% ready
                            </Text>
                          </View>
                        </Pressable>
                        {busyId === plan.id ? (
                          <View style={styles.moreBtn}>
                            <ActivityIndicator size="small" color={colors.accent} />
                          </View>
                        ) : (
                          <NativeMenu label={`Actions for ${plan.name}`} entries={menu}>
                            <View style={styles.moreBtn}>
                              <Icon name="more" size={18} color={colors.fgTertiary} />
                            </View>
                          </NativeMenu>
                        )}
                      </View>
                    )}
                  </NativeContextMenu>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
      <TextPromptModal
        visible={renamePlan != null}
        title="Rename plan"
        placeholder="Plan name"
        initialValue={renamePlan?.name ?? ""}
        onSubmit={(value) => {
          if (renamePlan) void runRename(renamePlan, value);
        }}
        onClose={() => setRenamePlan(null)}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { paddingTop: 8, paddingBottom: 32, gap: 12 },
    empty: {
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 32,
      paddingVertical: 40,
    },
    emptyTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
    },
    emptyBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    list: { marginHorizontal: 20, gap: 10 },
    plan: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    planBody: {
      flex: 1,
      minWidth: 0,
      gap: 6,
      paddingVertical: 14,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    moreBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    metaText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    readinessRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    readinessText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
  });
}
