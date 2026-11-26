import { useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { Icon, type IconName } from "@/components/ui/icon";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** How far the card must travel (or be flung) to grade it. */
const THRESHOLD = 96;
const RING_SIZE = 60;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SNAP_BACK = { damping: 18, stiffness: 220, mass: 0.8 } as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type SwipeGrade = "again" | "good";

type Props = {
  /** Changes for each card shown; a new key resets the swipe and plays the entrance. */
  cardKey: string;
  /** Swiping only grades a revealed card that isn't saving. */
  enabled: boolean;
  intervals: Record<SwipeGrade, string>;
  /** False when the grade wasn't taken, so the card springs back. */
  onGrade: (grade: SwipeGrade) => boolean;
  children: ReactNode;
};

/**
 * A study card that grades with a swipe: right for Good, left for Again. The
 * card lifts onto a surface as it moves, the grade it is heading for fills a
 * ring in the space it leaves, and crossing the line fills the ring, ticks,
 * and lets go to send the card off.
 */
export function SwipeGradeCard({
  cardKey,
  enabled,
  intervals,
  onGrade,
  children,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  // -1 Again, 1 Good, 0 neither: which side of the line the card is on.
  const armed = useSharedValue(0);
  const entrance = useSharedValue(1);
  // The card's own laid-out size, untransformed.
  const size = useSharedValue({ width, height: 0 });

  // Each new card settles in from slightly behind, whether the last one left
  // by swipe or by a grade button.
  useEffect(() => {
    x.value = 0;
    armed.value = 0;
    entrance.value = 0;
    entrance.value = withTiming(1, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [armed, cardKey, entrance, x]);

  const commit = (grade: SwipeGrade) => {
    if (!onGrade(grade)) {
      x.value = withSpring(0, SNAP_BACK);
      armed.value = 0;
    }
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Horizontal only, so the card's own scroll keeps vertical drags.
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onUpdate((event) => {
      x.value = event.translationX;
      const side =
        event.translationX > THRESHOLD
          ? 1
          : event.translationX < -THRESHOLD
            ? -1
            : 0;
      if (side !== armed.value) {
        armed.value = side;
        if (side !== 0) scheduleOnRN(haptics.selection);
      }
    })
    .onEnd((event) => {
      // A quick flick counts, even short of the line.
      const projected = event.translationX + event.velocityX * 0.12;
      const side = projected > THRESHOLD ? 1 : projected < -THRESHOLD ? -1 : 0;
      if (side === 0) {
        armed.value = 0;
        x.value = withSpring(0, { ...SNAP_BACK, velocity: event.velocityX });
        return;
      }
      armed.value = side;
      x.value = withTiming(
        side * width * 1.25,
        { duration: 200, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) scheduleOnRN(commit, side > 0 ? "good" : "again");
        },
      );
    });

  const cardStyle = useAnimatedStyle(() => {
    const degrees = interpolate(x.value, [-width, 0, width], [-9, 0, 9]);
    const angle = (Math.abs(degrees) * Math.PI) / 180;
    const scale =
      interpolate(entrance.value, [0, 1], [0.96, 1]) *
      interpolate(Math.abs(x.value), [0, 40], [1, 0.97], "clamp");
    // Tilting about the centre lifts the leading top corner. Left alone it
    // pokes under the transparent iOS bar, and iOS then lays its scroll edge
    // effect over the card's scroll view, which shows as a tilted bar along
    // the card's top. Drop the card by that much so its top never rises.
    const rise =
      (size.value.width / 2) * scale * Math.sin(angle) +
      (size.value.height / 2) * scale * Math.cos(angle) -
      size.value.height / 2;
    return {
      opacity:
        interpolate(
          Math.abs(x.value),
          [width * 0.6, width * 1.2],
          [1, 0],
          "clamp",
        ) * entrance.value,
      transform: [
        { translateX: x.value },
        {
          translateY:
            interpolate(entrance.value, [0, 1], [14, 0]) + Math.max(0, rise),
        },
        { rotate: `${degrees}deg` },
        { scale },
      ],
    };
  });

  // The card's own surface shows only while it is lifted off the page.
  const liftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(x.value), [0, 20], [0, 1], "clamp"),
  }));

  return (
    <View style={styles.area}>
      <EdgeGlow x={x} side={1} color={colors.gradeGood} />
      <EdgeGlow x={x} side={-1} color={colors.gradeAgain} />
      <GradeTarget
        x={x}
        armed={armed}
        side={1}
        label="Good"
        interval={intervals.good}
        icon="check"
        color={colors.gradeGood}
        styles={styles}
      />
      <GradeTarget
        x={x}
        armed={armed}
        side={-1}
        label="Again"
        interval={intervals.again}
        icon="undo"
        color={colors.gradeAgain}
        styles={styles}
      />
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.card, cardStyle]}
          onLayout={({ nativeEvent }) => {
            size.value = {
              width: nativeEvent.layout.width,
              height: nativeEvent.layout.height,
            };
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.lift, liftStyle]}
          />
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** A soft wash of the grade's colour from the edge the card is leaving. */
function EdgeGlow({
  x,
  side,
  color,
}: {
  x: SharedValue<number>;
  side: 1 | -1;
  color: string;
}) {
  const id = side > 0 ? "glowGood" : "glowAgain";
  const style = useAnimatedStyle(() => {
    const travel = Math.max(0, x.value * side);
    return {
      opacity: interpolate(
        travel,
        [0, THRESHOLD, THRESHOLD * 1.6],
        [0, 0.55, 0.8],
        "clamp",
      ),
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles_.glow,
        side > 0 ? styles_.glowLeft : styles_.glowRight,
        style,
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1={side > 0 ? "0" : "1"}
            y1="0"
            x2={side > 0 ? "1" : "0"}
            y2="0"
          >
            <Stop offset="0" stopColor={color} stopOpacity={0.32} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The grade a swipe is heading for, in the space the card leaves: a ring that
 * fills as the card nears the line, then floods with colour once past it.
 */
function GradeTarget({
  x,
  armed,
  side,
  label,
  interval,
  icon,
  color,
  styles,
}: {
  x: SharedValue<number>;
  armed: SharedValue<number>;
  side: 1 | -1;
  label: string;
  interval: string;
  icon: IconName;
  color: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const { colors } = useTheme();
  const pop = useSharedValue(1);
  const fill = useSharedValue(0);

  useAnimatedReaction(
    () => armed.value === side,
    (on, was) => {
      if (on === was) return;
      fill.value = withTiming(on ? 1 : 0, { duration: on ? 140 : 180 });
      if (on)
        pop.value = withSequence(
          withTiming(1.14, { duration: 110 }),
          withSpring(1, SNAP_BACK),
        );
    },
  );

  const wrapStyle = useAnimatedStyle(() => {
    const travel = Math.max(0, x.value * side);
    return {
      // Only once the card has moved far enough to uncover it.
      opacity: interpolate(travel, [28, 72], [0, 1], "clamp"),
      transform: [
        // Slides in from the edge alongside the card, then holds its place.
        {
          translateX: interpolate(
            travel,
            [0, THRESHOLD],
            [-18 * side, 0],
            "clamp",
          ),
        },
        {
          scale:
            interpolate(travel, [0, THRESHOLD], [0.82, 1], "clamp") * pop.value,
        },
      ],
    };
  });

  const ringProps = useAnimatedProps(() => {
    const travel = Math.max(0, x.value * side);
    const progress = Math.min(1, travel / THRESHOLD);
    return { strokeDashoffset: RING_LENGTH * (1 - progress) };
  });

  const discStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fill.value,
      [0, 1],
      [colors.bgSurface, color],
    ),
  }));
  const iconOnStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  const iconOffStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.target,
        side > 0 ? styles.targetLeft : styles.targetRight,
        wrapStyle,
      ]}
    >
      <Animated.View style={[styles.disc, discStyle]}>
        <Svg
          width={RING_SIZE}
          height={RING_SIZE}
          style={StyleSheet.absoluteFill}
        >
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.line}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            fill="none"
            // Start at twelve o'clock and run clockwise.
            rotation={-90}
            originX={RING_SIZE / 2}
            originY={RING_SIZE / 2}
            animatedProps={ringProps}
          />
        </Svg>
        <Animated.View style={[styles.iconLayer, iconOffStyle]}>
          <Icon name={icon} size={24} color={color} />
        </Animated.View>
        <Animated.View style={[styles.iconLayer, iconOnStyle]}>
          <Icon name={icon} size={24} color={colors.white} />
        </Animated.View>
      </Animated.View>
      <Text style={styles.targetLabel}>{label}</Text>
      <Text style={styles.targetInterval} numberOfLines={1}>
        {interval}
      </Text>
    </Animated.View>
  );
}

const styles_ = StyleSheet.create({
  glow: { position: "absolute", top: 0, bottom: 0, width: "55%" },
  glowLeft: { left: 0 },
  glowRight: { right: 0 },
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    area: { flex: 1, minHeight: 0, position: "relative" },
    card: { flex: 1, minHeight: 0 },
    lift: {
      position: "absolute",
      top: 10,
      left: 10,
      right: 10,
      bottom: 10,
      borderRadius: 28,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
    },
    target: {
      position: "absolute",
      top: "38%",
      width: 96,
      alignItems: "center",
      gap: 2,
    },
    targetLeft: { left: 8 },
    targetRight: { right: 8 },
    disc: {
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    iconLayer: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    targetLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    targetInterval: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
  });
}
