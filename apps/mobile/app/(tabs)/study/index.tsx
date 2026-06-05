import { router } from "expo-router";
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
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { StudyDeckOption } from "@deephaus/api-client";

export default function StudyHubScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [decks, setDecks] = useState<StudyDeckOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { decks: items } = await api.listDecks();
      setDecks(items);
    } catch {
      setDecks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasDue = decks.some((d) => d.due + d.new > 0);

  return (
    <View style={styles.root}>
      <PageHeader title="Study" />
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
          {decks.length === 0 ? (
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="book" variant="brand" size="lg" />
              <Text style={styles.emptyTitle}>No decks yet</Text>
              <Text style={styles.emptyBody}>
                Create a deck or subscribe to a community deck to start studying.
              </Text>
              <Button
                variant="brand"
                size="md"
                label="Create a deck"
                onPress={() => router.push("/(tabs)/create")}
                style={{ marginTop: 12 }}
              />
            </Card>
          ) : (
            <>
              {!hasDue && (
                <Card padding={16} style={{ gap: 6 }}>
                  <Text style={styles.allCaughtUp}>All caught up</Text>
                  <Text style={styles.allCaughtUpBody}>
                    No cards are due right now. Check back later, or study ahead from a deck below.
                  </Text>
                </Card>
              )}
              {decks.map((deck) => (
                <Pressable
                  key={deck.id}
                  onPress={() => router.push(`/(tabs)/study/${deck.id}`)}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <Card padding={14} style={{ gap: 12 }}>
                    <View style={styles.titleRow}>
                      <Icon name="book" size={20} color={colors.fgSecondary} />
                      <Text style={styles.title}>{deck.title}</Text>
                      <Icon name="arrowRightSmall" size={20} color={colors.fgQuaternary} />
                    </View>
                    <View style={styles.badges}>
                      {deck.due > 0 && (
                        <BadgePill icon="clock" label={`${deck.due} due`} tone="orange" />
                      )}
                      {deck.new > 0 && (
                        <BadgePill
                          icon="sparklesOutline"
                          label={`${deck.new} new`}
                          tone="brand"
                        />
                      )}
                      {deck.waiting > 0 && (
                        <BadgePill icon="bookmark" label={`${deck.waiting} waiting`} tone="gray" />
                      )}
                      {deck.due + deck.new === 0 && (
                        <BadgePill icon="check" label="Caught up" tone="good" />
                      )}
                    </View>
                    <ProgressBar
                      value={
                        deck.due + deck.new + deck.waiting === 0
                          ? 1
                          : deck.waiting / (deck.due + deck.new + deck.waiting)
                      }
                      height={4}
                    />
                  </Card>
                </Pressable>
              ))}
            </>
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
    content: { padding: 16, gap: 10 },
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
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    allCaughtUp: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.brand700,
    },
    allCaughtUpBody: {
      fontSize: 13,
      color: colors.fgTertiary,
    },
  });
}
