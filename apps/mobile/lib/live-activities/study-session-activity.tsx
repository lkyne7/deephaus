import {
  Gauge,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  progressViewStyle,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityEnvironment,
  type LiveActivityFactory,
  type LiveActivityLayout,
} from "expo-widgets";
import { liveActivitiesSupported, warnLiveActivity } from "./support";
import type { StudySessionActivityProps } from "./study-session-props";

export type { StudySessionActivityProps } from "./study-session-props";

/**
 * Rendered by the DeepHausWidgets extension, not by React Native. The function body is
 * serialised at build time (the 'widget' directive) and evaluated in an isolated JS
 * runtime that only knows the @expo/ui SwiftUI components and modifiers, so it must not
 * reference anything declared outside of it — colours and labels are inlined on purpose.
 */
function StudySessionLayout(
  props: StudySessionActivityProps,
  env: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";
  const accent = "#4FB3B1";
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const total = props.done + props.remaining;
  const fraction = props.status === "complete" ? 1 : total > 0 ? Math.min(1, props.done / total) : 0;
  const percent = Math.round(fraction * 100);
  const complete = props.status === "complete";
  const startedAt = new Date(props.startedAt);
  const stale = env.isStale === true && !complete;
  const leftLabel = complete ? "Done" : `${props.remaining} left`;

  // The circular capacity gauge has a fixed intrinsic size (~58pt) that ignores frame(),
  // so it is scaled down to the slot it sits in; otherwise it spills past the island's
  // rounded edges. Gauge labels are not drawn inside Live Activities, so the percentage
  // is overlaid.
  const gauge = (size: number) => (
    <ZStack alignment="center" modifiers={[frame({ width: size, height: size })]}>
      <Gauge value={fraction} modifiers={[gaugeStyle("circularCapacity"), tint(accent), scaleEffect(size / 58)]}>
        <Text>Progress</Text>
      </Gauge>
    </ZStack>
  );
  const ring = (size: number) => (
    <ZStack alignment="center" modifiers={[frame({ width: size, height: size })]}>
      {gauge(size)}
      <Text
        modifiers={[
          font({ size: size >= 40 ? 11 : 10, weight: "bold", design: "rounded" }),
          monospacedDigit(),
          minimumScaleFactor(0.7),
        ]}
      >
        {`${percent}%`}
      </Text>
    </ZStack>
  );

  const timer = (
    <Text
      date={startedAt}
      dateStyle="timer"
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
  );

  const titleBlock = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1), minimumScaleFactor(0.85)]}>
        {complete ? "Session complete" : props.title}
      </Text>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary), lineLimit(1)]}>
        {complete
          ? `${props.summary} · ${props.title}`
          : stale
            ? "Open DeepHaus to resume"
            : props.subtitle}
      </Text>
    </VStack>
  );

  const stat = (value: number, label: string, color?: string) => (
    <HStack spacing={3} alignment="firstTextBaseline">
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold" }),
          monospacedDigit(),
          ...(color ? [foregroundStyle(color)] : []),
        ]}
      >
        {`${value}`}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(color ? color : secondary)]}>{label}</Text>
    </HStack>
  );

  const activeStats = (
    <HStack>
      {stat(props.done, "done")}
      <Spacer />
      {stat(props.remaining, "left")}
      <Spacer />
      {stat(props.again, "again")}
    </HStack>
  );

  const gradeStats = (
    <HStack>
      {stat(props.again, "again", "#F97066")}
      <Spacer />
      {stat(props.hard, "hard", "#B692F6")}
      <Spacer />
      {stat(props.good, "good", "#4FB3B1")}
      <Spacer />
      {stat(props.easy, "easy", "#47CD89")}
    </HStack>
  );

  const bar = (
    <ProgressView value={fraction} modifiers={[progressViewStyle("linear"), tint(accent)]} />
  );

  const banner = (
    <VStack alignment="leading" spacing={10} modifiers={[padding({ horizontal: 16, vertical: 14 })]}>
      <HStack spacing={12} alignment="center">
        {complete ? (
          <Image systemName="trophy.fill" size={30} color={accent} modifiers={[frame({ width: 44, height: 44 })]} />
        ) : (
          ring(44)
        )}
        {titleBlock}
        <Spacer />
        {complete ? null : (
          <VStack alignment="trailing" spacing={2}>
            {timer}
            <Text
              modifiers={[font({ size: 12, weight: "semibold" }), monospacedDigit(), foregroundStyle(accent)]}
            >
              {leftLabel}
            </Text>
          </VStack>
        )}
      </HStack>
      {complete ? gradeStats : bar}
      {complete ? null : activeStats}
    </VStack>
  );

  return {
    banner,
    bannerSmall: (
      <HStack spacing={10} modifiers={[padding({ all: 12 })]}>
        {complete ? <Image systemName="trophy.fill" size={22} color={accent} /> : ring(40)}
        {titleBlock}
      </HStack>
    ),
    compactLeading: (
      <Image
        systemName={complete ? "checkmark.circle.fill" : "rectangle.stack.fill"}
        size={14}
        color={accent}
        modifiers={[padding({ leading: 4 })]}
      />
    ),
    compactTrailing: (
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold", design: "rounded" }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.7),
          padding({ trailing: 2 }),
        ]}
      >
        {leftLabel}
      </Text>
    ),
    minimal: complete ? (
      <Image systemName="checkmark.circle.fill" size={14} color={accent} />
    ) : (
      gauge(22)
    ),
    // The expanded leading/trailing regions sit beside the camera, under the island's
    // rounded top corners, so their content is kept small and inset from the edge.
    expandedLeading: complete ? (
      <Image
        systemName="trophy.fill"
        size={24}
        color={accent}
        modifiers={[frame({ width: 40, height: 40 }), padding({ leading: 6, top: 2 })]}
      />
    ) : (
      <ZStack modifiers={[padding({ leading: 6, top: 2 })]}>{ring(40)}</ZStack>
    ),
    expandedCenter: titleBlock,
    expandedTrailing: complete ? null : <ZStack modifiers={[padding({ trailing: 6, top: 2 })]}>{timer}</ZStack>,
    // The bottom corners are the most rounded part of the island; keep the end stats clear of them.
    expandedBottom: (
      <VStack spacing={8} modifiers={[padding({ top: 6, horizontal: 10, bottom: 4 })]}>
        {complete ? gradeStats : bar}
        {complete ? null : activeStats}
      </VStack>
    ),
  };
}

let factory: LiveActivityFactory<StudySessionActivityProps> | null | undefined;

/** The factory is created lazily: ActivityKit is iOS-only and the layout store needs the App Group. */
export function getStudySessionActivityFactory(): LiveActivityFactory<StudySessionActivityProps> | null {
  if (factory !== undefined) return factory;
  factory = null;
  if (!liveActivitiesSupported) return factory;
  try {
    factory = createLiveActivity<StudySessionActivityProps>("StudySession", StudySessionLayout);
  } catch (error) {
    warnLiveActivity("create StudySession factory", error);
  }
  return factory;
}
