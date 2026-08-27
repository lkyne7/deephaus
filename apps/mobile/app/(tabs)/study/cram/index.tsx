import type { CramPlanListItem } from "@deephaus/api-client";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { Icon } from "@/components/ui/icon";
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  compareCramPlansByDefault,
  cramStatusLabel,
  cramStatusTone,
  deadlineCountdown,
  readinessPct,
} from "@/lib/cram";
import { goBackOrReplace } from "@/lib/navigation";
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
  const [showArchived, setShowArchived] = useState(false);

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
        .filter((plan) => showArchived || plan.status !== "archived")
        .slice()
        .sort(compareCramPlansByDefault),
    [plans, showArchived],
  );
  const archivedCount = plans.filter((plan) => plan.status === "archived").length;

  return (
    <View style={styles.root}>
      <PageHeader
        title="Cram plans"
        onBack={() => goBackOrReplace("/(tabs)/study")}
        right={
          <PageHeaderIconButton
            icon="add"
            label="New Cram Plan"
            onPress={() => router.push("/(tabs)/study/cram/create")}
          />
        }
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
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
              <FeaturedIcon icon="calendar" variant="brand" size="lg" />
              <Text style={styles.emptyTitle}>No Cram Plans yet</Text>
              <Text style={styles.emptyBody}>
                Set a deadline, pick your decks, and get a daily study plan that
                gets you exam-ready in time.
              </Text>
              <Button
                variant="brand"
                size="md"
                label="Create a Cram Plan"
                leadingIcon="add"
                onPress={() => router.push("/(tabs)/study/cram/create")}
                style={{ marginTop: 12 }}
              />
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

          {archivedCount > 0 && (
            <Pressable onPress={() => setShowArchived((v) => !v)} hitSlop={6}>
              <Text style={styles.archivedToggle}>
                {showArchived
                  ? "Hide archived"
                  : `Show ${archivedCount} archived plan${archivedCount === 1 ? "" : "s"}`}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
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
    archivedToggle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.brand600,
      textAlign: "center",
      paddingVertical: 8,
    },
  });
}
