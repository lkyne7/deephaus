import type { Project } from "@deephaus/shared";
import type { DashboardStats } from "@deephaus/api-client";
import { router, type Href } from "expo-router";
import { useDrawerStatus, type DrawerContentComponentProps } from "expo-router/drawer";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openBackgroundTask } from "@/components/background-tasks-banner";
import { Avatar } from "@/components/ui/avatar";
import { Icon, type IconName } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import {
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks-context";
import { deckDisplayName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const RECENT_DECKS = 5;

/** Drawer screens, in sidebar order. `name` is the folder under app/(app). */
export const SIDEBAR_SECTIONS: { name: string; label: string; icon: IconName; href: Href }[] = [
  { name: "home", label: "Home", icon: "home", href: "/home" },
  { name: "decks", label: "Decks", icon: "folder", href: "/decks" },
  { name: "cards", label: "Cards", icon: "layers", href: "/cards" },
  { name: "cram", label: "Cram", icon: "bolt", href: "/cram" },
  { name: "community", label: "Community", icon: "community", href: "/community" },
  { name: "insights", label: "Insights", icon: "barChart", href: "/insights" },
];

type RecentDeck = { id: string; title: string; due: number };

/**
 * Most recently touched decks: studied, edited or just made. Due counts come
 * from the dashboard stats, recency from whichever of the two is newer.
 */
function recentDecks(projects: Project[], stats: DashboardStats | null): RecentDeck[] {
  const perDeck = new Map((stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck]));
  return projects
    .map((project) => {
      const stat = perDeck.get(project.id);
      const touched = [project.updated_at, stat?.last_reviewed ?? ""].sort().at(-1) ?? "";
      return {
        id: project.id,
        title: deckDisplayName(project.deck_name || project.name),
        due: stat?.due ?? 0,
        touched,
      };
    })
    .sort((a, b) => b.touched.localeCompare(a.touched))
    .slice(0, RECENT_DECKS)
    .map(({ touched: _touched, ...deck }) => deck);
}

function initialsFor(name: string, email: string) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  return (email[0] ?? "?").toUpperCase();
}

/** Claude-style sidebar: search, the app's areas, running jobs, recent decks, account. */
export function AppSidebar({ state, navigation }: DrawerContentComponentProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const drawerStatus = useDrawerStatus();
  const { user } = useAuth();
  const { tasks } = useBackgroundTasks();
  const [decks, setDecks] = useState<RecentDeck[]>([]);

  const activeSection = state.routes[state.index]?.name;

  // Refresh each time the sidebar opens, so a deck made or studied a moment
  // ago is already listed.
  const loadDecks = useCallback(() => {
    void Promise.all([
      offlineData.listProjects(),
      offlineData.getDashboardStats().catch(() => null),
    ])
      .then(([projects, stats]) => setDecks(recentDecks(projects, stats)))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (drawerStatus === "open") loadDecks();
  }, [drawerStatus, loadDecks]);
  useEffect(loadDecks, [loadDecks]);

  const visibleTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "failed",
  );

  const name =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    "";
  const email = user?.email ?? "";

  function go(action: () => void) {
    navigation.closeDrawer();
    action();
  }

  function openTask(task: BackgroundTask) {
    go(() => {
      // A card-making run reopens as its thread on Home.
      if (task.kind === "generation") {
        router.navigate({ pathname: "/home", params: { task: task.id } });
        return;
      }
      openBackgroundTask(task);
    });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => go(() => router.push("/search"))}
          accessibilityRole="search"
          accessibilityLabel="Search decks, cards and community"
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <Icon name="search" size={16} color={colors.fgTertiary} />
          <Text style={styles.searchText}>Search</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            go(() => router.navigate({ pathname: "/home", params: { fresh: String(Date.now()) } }))
          }
          accessibilityRole="button"
          accessibilityLabel="New cards"
          hitSlop={6}
          style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
        >
          <Icon name="add" size={20} color={colors.actionPrimaryFg} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {SIDEBAR_SECTIONS.map((section) => {
          const active = section.name === activeSection;
          return (
            <Pressable
              key={section.name}
              onPress={() => go(() => router.navigate(section.href))}
              accessibilityRole="button"
              accessibilityLabel={section.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.navRow,
                active && styles.navRowActive,
                pressed && !active && styles.navRowPressed,
              ]}
            >
              <Icon
                name={section.icon}
                size={20}
                color={active ? colors.fgPrimary : colors.fgSecondary}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                {section.label}
              </Text>
            </Pressable>
          );
        })}

        {visibleTasks.length > 0 ? (
          <>
            <Text style={styles.caption} accessibilityRole="header">
              In progress
            </Text>
            {visibleTasks.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => openTask(task)}
                accessibilityRole="button"
                accessibilityLabel={`${task.deckName ?? task.title}, ${taskPhaseLabel(task)}`}
                style={({ pressed }) => [styles.listRow, pressed && styles.navRowPressed]}
              >
                {task.status === "running" ? (
                  <ActivityIndicator size="small" color={colors.accent} style={styles.taskIcon} />
                ) : (
                  <Icon name="warning" size={18} color={colors.fgError} style={styles.taskIcon} />
                )}
                <View style={styles.taskText}>
                  <Text style={styles.listLabel} numberOfLines={1}>
                    {task.deckName ?? task.title}
                  </Text>
                  <Text style={styles.taskPhase} numberOfLines={1}>
                    {task.status === "failed" ? "Didn't finish" : taskPhaseLabel(task)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}

        {decks.length > 0 ? (
          <>
            <Text style={styles.caption} accessibilityRole="header">
              Recent decks
            </Text>
            {decks.map((deck) => (
              <Pressable
                key={deck.id}
                onPress={() => go(() => router.push(`/decks/${deck.id}`))}
                accessibilityRole="button"
                accessibilityLabel={deck.due > 0 ? `${deck.title}, ${deck.due} due` : deck.title}
                style={({ pressed }) => [styles.listRow, pressed && styles.navRowPressed]}
              >
                <Text style={[styles.listLabel, styles.deckLabel]} numberOfLines={1}>
                  {deck.title}
                </Text>
                {deck.due > 0 ? (
                  <View style={styles.due}>
                    <View style={styles.dueDot} />
                    <Text style={styles.dueText}>{deck.due}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={() => go(() => router.push("/profile"))}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={({ pressed }) => [
          styles.account,
          { paddingBottom: Math.max(insets.bottom, 12) },
          pressed && styles.pressed,
        ]}
      >
        <Avatar
          initials={initialsFor(name, email)}
          size="sm"
          variant="soft"
          style={styles.avatar}
        />
        <View style={styles.accountText}>
          <Text style={styles.accountName} numberOfLines={1}>
            {name || email || "Account"}
          </Text>
          {name && email ? (
            <Text style={styles.accountEmail} numberOfLines={1}>
              {email}
            </Text>
          ) : null}
        </View>
        <Icon name="settings" size={20} color={colors.fgSecondary} />
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgRail },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 10,
    },
    search: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 40,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.bgActive,
    },
    searchText: { fontSize: 16, lineHeight: 20, color: colors.fgTertiary },
    newButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.actionPrimaryBg,
    },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 8, paddingBottom: 16 },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 12,
    },
    navRowActive: { backgroundColor: colors.bgActive },
    navRowPressed: { backgroundColor: colors.bgHover },
    navLabel: { fontSize: 17, lineHeight: 22, color: colors.fgPrimary },
    navLabelActive: { fontWeight: "600" },
    caption: {
      marginTop: 18,
      marginBottom: 4,
      paddingHorizontal: 12,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: 12,
    },
    listLabel: { fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    deckLabel: { flex: 1, minWidth: 0 },
    taskIcon: { width: 20 },
    taskText: { flex: 1, minWidth: 0, paddingVertical: 4 },
    taskPhase: { fontSize: 13, lineHeight: 17, color: colors.fgTertiary },
    due: { flexDirection: "row", alignItems: "center", gap: 5 },
    dueDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.dueDot,
    },
    dueText: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    account: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingTop: 12,
      paddingHorizontal: 18,
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    avatar: { backgroundColor: colors.bgActive },
    accountText: { flex: 1, minWidth: 0 },
    accountName: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: colors.fgPrimary },
    accountEmail: { fontSize: 13, lineHeight: 17, color: colors.fgTertiary },
    pressed: { opacity: 0.6 },
  });
}
