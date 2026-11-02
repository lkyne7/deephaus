import { HStack, Image, ProgressView, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityFactory,
  type LiveActivityLayout,
} from "expo-widgets";
import { liveActivitiesSupported, warnLiveActivity } from "./support";
import type { TaskActivityProps } from "./task-activity-props";

export type { TaskActivityProps } from "./task-activity-props";

/**
 * Rendered by the DeepHausWidgets extension. See study-session-activity.tsx for the
 * constraints of the 'widget' directive: nothing outside this function may be referenced.
 *
 * While the app is suspended no updates arrive, so the bar is timer-driven whenever an
 * estimate exists: SwiftUI keeps filling it towards `etaAt` on its own.
 */
function TaskLayout(props: TaskActivityProps, env: LiveActivityEnvironment): LiveActivityLayout {
  "widget";
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const running = props.status === "running";
  const failed = props.status === "failed";
  const accent = failed
    ? "#F97066"
    : props.status === "ready"
      ? "#47CD89"
      : props.kind === "generation"
        ? "#F38744"
        : "#4FB3B1";
  const symbol = failed
    ? "exclamationmark.triangle.fill"
    : props.status === "ready"
      ? "checkmark.circle.fill"
      : props.kind === "generation"
        ? "sparkles"
        : props.kind === "anki-import"
          ? "square.and.arrow.down.fill"
          : "square.and.arrow.up.fill";
  const now = Date.now();
  const timed = running && props.etaAt != null && props.etaAt > now + 5_000;
  const stale = env.isStale === true && running;
  const phase = stale ? "Open DeepHaus to refresh" : props.phase;
  const percentLabel = `${Math.round(props.progress)}%`;

  const icon = (size: number, box = 44) => (
    <Image systemName={symbol} size={size} color={accent} modifiers={[frame({ width: box, height: box })]} />
  );

  const bar = running ? (
    timed ? (
      <ProgressView
        timerInterval={{ lower: new Date(props.startedAt), upper: new Date(props.etaAt ?? now) }}
        countsDown={false}
        modifiers={[progressViewStyle("linear"), tint(accent)]}
      />
    ) : (
      <ProgressView value={props.progress / 100} modifiers={[progressViewStyle("linear"), tint(accent)]} />
    )
  ) : null;

  const eta = timed ? (
    <Text
      timerInterval={{ lower: new Date(props.startedAt), upper: new Date(props.etaAt ?? now) }}
      countsDown
      modifiers={[
        font({ size: 15, weight: "semibold", design: "rounded" }),
        monospacedDigit(),
        foregroundStyle(secondary),
        // A timer Text claims all offered width unless it is given a fixed one.
        multilineTextAlignment("trailing"),
        lineLimit(1),
        minimumScaleFactor(0.75),
        frame({ width: 62, alignment: "trailing" }),
      ]}
    />
  ) : (
    <Text
      modifiers={[
        font({ size: 15, weight: "semibold", design: "rounded" }),
        monospacedDigit(),
        foregroundStyle(running ? secondary : accent),
      ]}
    >
      {running ? percentLabel : ""}
    </Text>
  );

  const titleBlock = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1), minimumScaleFactor(0.85)]}>
        {props.title}
      </Text>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary), lineLimit(2)]}>
        {running ? `${props.detail}` : failed ? props.phase : props.detail}
      </Text>
    </VStack>
  );

  const phaseRow = running ? (
    <HStack>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(1)]}>{phase}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 12, weight: "semibold" }), monospacedDigit(), foregroundStyle(accent)]}>
        {percentLabel}
      </Text>
    </HStack>
  ) : null;

  const banner = (
    <VStack alignment="leading" spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      <HStack spacing={12} alignment="center">
        {icon(30)}
        {titleBlock}
        <Spacer />
        {running ? eta : null}
      </HStack>
      {bar}
      {phaseRow}
    </VStack>
  );

  return {
    banner,
    bannerSmall: (
      <HStack spacing={10} modifiers={[padding({ all: 12 })]}>
        <Image systemName={symbol} size={22} color={accent} />
        {titleBlock}
      </HStack>
    ),
    compactLeading: (
      <Image systemName={symbol} size={14} color={accent} modifiers={[padding({ leading: 4 })]} />
    ),
    compactTrailing: running ? (
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold", design: "rounded" }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.7),
          padding({ trailing: 2 }),
        ]}
      >
        {percentLabel}
      </Text>
    ) : (
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold" }),
          foregroundStyle(accent),
          lineLimit(1),
          minimumScaleFactor(0.7),
          padding({ trailing: 2 }),
        ]}
      >
        {failed ? "Failed" : "Done"}
      </Text>
    ),
    minimal: <Image systemName={symbol} size={14} color={accent} />,
    // Leading/trailing sit under the island's rounded top corners; bottom content is kept
    // clear of the even rounder bottom corners.
    expandedLeading: <ZStack modifiers={[padding({ leading: 6, top: 2 })]}>{icon(24, 40)}</ZStack>,
    expandedCenter: titleBlock,
    expandedTrailing: running ? <ZStack modifiers={[padding({ trailing: 6, top: 2 })]}>{eta}</ZStack> : null,
    expandedBottom: running ? (
      <VStack spacing={8} modifiers={[padding({ top: 6, horizontal: 10, bottom: 4 })]}>
        {bar}
        {phaseRow}
      </VStack>
    ) : null,
  };
}

let factory: LiveActivityFactory<TaskActivityProps> | null | undefined;

export function getTaskActivityFactory(): LiveActivityFactory<TaskActivityProps> | null {
  if (factory !== undefined) return factory;
  factory = null;
  if (!liveActivitiesSupported) return factory;
  try {
    factory = createLiveActivity<TaskActivityProps>("BackgroundTask", TaskLayout);
  } catch (error) {
    warnLiveActivity("create BackgroundTask factory", error);
  }
  return factory;
}
