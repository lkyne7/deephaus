import { router, type Href } from "expo-router";
import {
  useDrawerProgress,
  useDrawerStatus,
  type DrawerContentComponentProps,
} from "expo-router/drawer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openBackgroundTask } from "@/components/background-tasks-banner";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import {
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks-context";
import { haptics } from "@/lib/haptics";
import { brandFont } from "@/lib/fonts";
import { offlineData } from "@/lib/offline-data";
import { recentDecks, type RecentDeck } from "@/lib/recent-decks";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import {
  SIDEBAR_START_SCALE,
  SIDEBAR_VEIL_INPUT,
  SIDEBAR_VEIL_OUTPUT,
  sidebarWidth,
} from "./sidebar-motion";

const RECENT_DECKS = 5;

/** Drawer screens, in sidebar order. `name` is the folder under app/(app). */
export const SIDEBAR_SECTIONS: { name: string; label: string; icon: IconName; href: Href }[] = [
  { name: "home", label: "Home", icon: "home", href: "/home" },
  { name: "decks", label: "Decks", icon: "folder", href: "/decks" },
  { name: "cards", label: "Cards", icon: "layers", href: "/cards" },
  { name: "exams", label: "Exams", icon: "calendar", href: "/exams" },
  { name: "community", label: "Community", icon: "community", href: "/community" },
  { name: "insights", label: "Insights", icon: "barChart", href: "/insights" },
];

/** Claude-style sidebar: search, the app's areas, running jobs, recent decks, account. */
export function AppSidebar({ state, navigation }: DrawerContentComponentProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const drawerStatus = useDrawerStatus();
  const drawer = useDrawerProgress();
  const { width: screenWidth } = useWindowDimensions();
  // Waits underneath the page, growing and brightening into place as the
  // page slides off it, as Claude's and ChatGPT's sidebars do (sidebar-motion).
  const behind = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(drawer.value, [0, 1], [SIDEBAR_START_SCALE, 1]) }],
  }));
  const behindDim = useAnimatedStyle(() => ({
    opacity: interpolate(drawer.value, SIDEBAR_VEIL_INPUT, SIDEBAR_VEIL_OUTPUT, "clamp"),
  }));
  // Grow about the screen's centre, not the sidebar's own.
  const growOrigin = `${((screenWidth / 2 / sidebarWidth(screenWidth)) * 100).toFixed(1)}%`;
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
      .then(([projects, stats]) => setDecks(recentDecks(projects, stats, RECENT_DECKS)))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (drawerStatus === "open") loadDecks();
  }, [drawerStatus, loadDecks]);

  // A firm tap as the sidebar commits to opening or closing (menu button,
  // swipe, or a tap on the page), as in Claude's app. Status flips once each
  // way, so a held swipe fires once. Choosing an item already tapped in go(),
  // so the close that follows stays quiet.
  const wasOpen = useRef(false);
  const choseItem = useRef(false);
  useEffect(() => {
    const open = drawerStatus === "open";
    if (open !== wasOpen.current) {
      if (open || !choseItem.current) haptics.medium();
      choseItem.current = false;
    }
    wasOpen.current = open;
  }, [drawerStatus]);
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
    haptics.medium();
    choseItem.current = true;
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
    // The top row starts at the safe area and is as tall as a navigation bar, so
    // its buttons line up with the page's menu button beside the open sidebar.
    // The rail colour stays put behind; only the contents grow into place, so
    // no edge of it shows while they're smaller.
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.grow,
          { paddingTop: insets.top, transformOrigin: [growOrigin, "50%", 0] },
          behind,
        ]}
      >
        <View style={styles.topRow}>
          {/* The wordmark takes you Home, like a site logo. */}
          <Pressable
            onPress={() => go(() => router.navigate("/home"))}
            accessibilityRole="button"
            accessibilityLabel="DeepHaus, go to Home"
            hitSlop={8}
            style={({ pressed }) => pressed && styles.wordmarkPressed}
          >
            <Text style={[styles.wordmark, brandFont()]}>DeepHaus</Text>
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

        {/* Like Claude's app: your picture bottom-left, the main action bottom-right. */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* System buttons with SF Symbols: glass on iOS 26, standard elsewhere. */}
          <Button
            iconOnly
            leadingIcon="user"
            variant="secondary"
            size="lg"
            accessibilityLabel={`${name || email || "Account"}, settings`}
            // Settings rises as a sheet over the open sidebar, as in Claude's
            // app, and closing it comes back to the sidebar.
            onPress={() => {
              haptics.medium();
              router.push("/profile");
            }}
          />
          <Button
            label="New cards"
            leadingIcon="add"
            variant="primary"
            size="lg"
            accessibilityHint="Opens the composer, ready to type"
            onPress={() =>
              go(() =>
                router.navigate({
                  pathname: "/home",
                  params: { fresh: String(Date.now()) },
                }),
              )
            }
          />
        </View>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.behindDim, behindDim]} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgRail },
    grow: { flex: 1 },
    behindDim: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "#000",
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 44,
      // The wordmark starts where the section labels' icons do.
      paddingLeft: 20,
      paddingRight: 14,
      marginBottom: 10,
    },
    wordmark: {
      fontSize: 22,
      lineHeight: 26,
      letterSpacing: -0.1,
      color: colors.fgPrimary,
    },
    wordmarkPressed: { opacity: 0.5 },
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
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 10,
      paddingLeft: 16,
      paddingRight: 14,
    },
    pressed: { opacity: 0.6 },
  });
}
