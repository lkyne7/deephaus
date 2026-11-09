import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  GlassSurface,
  liquidGlassAvailable,
} from "@/components/ui/glass-surface";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Icon } from "@/components/ui/icon";
import {
  estimateTaskEtaMs,
  formatTaskEta,
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks-context";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { openDeck } from "@/lib/sections";

function pickBannerTask(tasks: BackgroundTask[]) {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length > 0) return running[0];
  const finished = tasks.filter(
    (task) => task.status === "ready" || task.status === "failed",
  );
  return finished[0] ?? null;
}

/** Default destination for a task: its deck, the import screen, or the share sheet. */
export function openBackgroundTask(task: BackgroundTask) {
  if (task.kind === "generation" && task.projectId) {
    // Lands on top of the Decks list, so Back works from any area.
    openDeck(task.projectId);
    return;
  }
  if (task.kind === "anki-import") {
    router.push("/home/import", { withAnchor: true });
    return;
  }
  if (task.kind === "anki-export" && task.status === "ready" && task.exportLocalUri) {
    void Sharing.isAvailableAsync().then((available) => {
      if (available && task.exportLocalUri) {
        return Sharing.shareAsync(task.exportLocalUri, {
          mimeType: "application/octet-stream",
          dialogTitle: "Export Anki deck",
        });
      }
    });
  }
}

type BannerProps = {
  /** A task already on screen, which the banner should not repeat. */
  excludeTaskId?: string | null;
  /** Handle a tap here instead of the default destination. Return true if handled. */
  onOpenTask?: (task: BackgroundTask) => boolean;
};

export function BackgroundTasksBanner({ excludeTaskId, onOpenTask }: BannerProps = {}) {
  const { colors, shadows: themeShadows } = useTheme();
  const styles = useMemo(
    () => createStyles(colors, themeShadows),
    [colors, themeShadows],
  );
  const { tasks, activeCount, dismissTask } = useBackgroundTasks();
  const [, setNowTick] = useState(0);

  const task = pickBannerTask(tasks.filter((item) => item.id !== excludeTaskId));

  useEffect(() => {
    if (!task || task.status !== "running") return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [task?.id, task?.status]);

  if (!task) return null;

  const etaMs = estimateTaskEtaMs(task);
  const phase = taskPhaseLabel(task);
  // Generated cards are already in the deck; the banner says so and opens them.
  const generationDone = task.kind === "generation" && task.status === "ready";
  const title = generationDone
    ? `${phase}${task.deckName ? ` to ${task.deckName}` : ""}`
    : task.title;
  const subtitle =
    (activeCount > 1 ? `${activeCount} tasks running · ` : "") +
    (generationDone ? "Tap to view" : phase) +
    (task.status === "running" && etaMs != null
      ? ` · ${formatTaskEta(etaMs)}`
      : "");

  function openTask() {
    if (task && onOpenTask?.(task)) return;
    if (task) openBackgroundTask(task);
  }

  return (
    <View pointerEvents="box-none">
      <GlassSurface
        fallbackColor={colors.bgSurface}
        glassEffectStyle="regular"
        interactive
        style={styles.banner}
      >
        <View style={styles.bannerRow}>
          <Pressable
            onPress={openTask}
            style={({ pressed }) => [
              styles.bannerContent,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${subtitle}`}
          >
            {task.status === "running" ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Icon
                name={task.status === "ready" ? "checkCircle" : "warning"}
                size={20}
                color={
                  task.status === "ready" ? colors.accent : colors.fgError
                }
              />
            )}

            <View style={styles.copy}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {subtitle}
              </Text>
              {task.status === "running" ? (
                <ProgressBar
                  value={Math.min(1, Math.max(0, task.progress / 100))}
                  height={4}
                  style={{ marginTop: 8 }}
                />
              ) : null}
            </View>

            {task.status === "running" ? (
              <Icon
                name="arrowRightSmall"
                size={18}
                color={colors.fgQuaternary}
              />
            ) : null}
          </Pressable>
          {/* A sibling, not a child, of the banner button: nested buttons lose their taps
              to the outer one and are hidden from VoiceOver. */}
          {task.status !== "running" ? (
            <Pressable
              onPress={() => dismissTask(task.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [
                styles.dismiss,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Icon name="close" size={18} color={colors.fgQuaternary} />
            </Pressable>
          ) : null}
        </View>
      </GlassSurface>
    </View>
  );
}

function createStyles(
  colors: ThemeColors,
  themeShadows: ReturnType<typeof useTheme>["shadows"],
) {
  return StyleSheet.create({
    banner: {
      borderRadius: radius.xl3,
      overflow: "hidden",
      borderWidth: liquidGlassAvailable ? 0 : 1,
      borderColor: colors.line,
      ...themeShadows.sm,
    },
    bannerRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    bannerContent: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    copy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 12,
      lineHeight: 17,
      color: colors.fgTertiary,
    },
    dismiss: {
      paddingVertical: 12,
      paddingLeft: 4,
      paddingRight: 14,
      alignSelf: "stretch",
      justifyContent: "center",
    },
  });
}
