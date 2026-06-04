import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Icon } from "@/components/ui/icon";
import {
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

  const task = pickBannerTask(tasks);
  if (!task) return null;

  const tabBarOffset = Platform.OS === "ios" ? 84 : 64;

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
        accessibilityLabel={taskPhaseLabel(task)}
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
            {activeCount > 1 ? `${activeCount} tasks running · ` : ""}
            {taskPhaseLabel(task)}
          </Text>
          {task.status === "running" ? (
            <ProgressBar value={task.progress / 100} height={4} style={{ marginTop: 8 }} />
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
      borderRadius: radius.xl,
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      ...themeShadows.md,
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
