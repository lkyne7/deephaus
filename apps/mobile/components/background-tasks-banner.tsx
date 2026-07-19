import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
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

function pickBannerTask(tasks: BackgroundTask[]) {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length > 0) return running[0];
  const finished = tasks.filter((task) => task.status === "ready" || task.status === "failed");
  return finished[0] ?? null;
}

export function BackgroundTasksBanner() {
  const { colors, shadows: themeShadows } = useTheme();
  const styles = useMemo(() => createStyles(colors, themeShadows), [colors, themeShadows]);
  const { tasks, activeCount, dismissTask } = useBackgroundTasks();
  const [, setNowTick] = useState(0);

  const task = pickBannerTask(tasks);

  useEffect(() => {
    if (!task || task.status !== "running") return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [task?.id, task?.status]);

  if (!task) return null;

  const tabBarOffset = Platform.OS === "ios" ? 84 : 64;
  const etaMs = estimateTaskEtaMs(task);
  const phase = taskPhaseLabel(task);
  const subtitle =
    (activeCount > 1 ? `${activeCount} tasks running · ` : "") +
    phase +
    (task.status === "running" && etaMs != null ? ` · ${formatTaskEta(etaMs)}` : "");

  function openTask() {
    if (task?.kind === "generation" && task.projectId) {
      if (task.status === "ready" && task.jobId) {
        router.push(`/(tabs)/create/${task.projectId}/review?job_id=${task.jobId}`);
        return;
      }
      router.push(`/(tabs)/create/${task.projectId}`);
      return;
    }
    if (task?.kind === "anki-import") {
      router.push("/(tabs)/create/import");
    }
  }

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: tabBarOffset + 8 }]}>
      <Pressable
        onPress={openTask}
        style={({ pressed }) => [styles.banner, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel={phase}
      >
        {task.status === "running" ? (
          <ActivityIndicator color={colors.brand500} size="small" />
        ) : (
          <Icon
            name={task.status === "ready" ? "checkCircle" : "warning"}
            size={20}
            color={task.status === "ready" ? colors.gradeEasy : colors.gradeAgain}
          />
        )}

        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
          {task.status === "running" ? (
            <ProgressBar value={Math.min(1, Math.max(0, task.progress / 100))} height={4} style={{ marginTop: 8 }} />
          ) : null}
        </View>

        {task.status !== "running" ? (
          <Pressable
            onPress={() => dismissTask(task.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.6 }]}
          >
            <Icon name="close" size={18} color={colors.fgQuaternary} />
          </Pressable>
        ) : (
          <Icon name="arrowRightSmall" size={18} color={colors.fgQuaternary} />
        )}
      </Pressable>
    </View>
  );
}

function createStyles(
  colors: ThemeColors,
  themeShadows: ReturnType<typeof useTheme>["shadows"],
) {
  return StyleSheet.create({
    host: {
      position: "absolute",
      left: 12,
      right: 12,
      zIndex: 20,
    },
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: radius.xl2,
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      ...themeShadows.sm,
    },
    copy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 12,
      lineHeight: 17,
      color: colors.fgTertiary,
    },
    dismiss: {
      padding: 4,
    },
  });
}
