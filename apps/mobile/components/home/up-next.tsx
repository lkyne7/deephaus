import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type EntryAnimationsValues,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { CardPreviewText } from "@/components/create/card-preview-text";
import { HOME_MOTION } from "@/components/home/home-motion";
import { Icon, type IconName } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import {
  estimateTaskEtaMs,
  formatTaskEta,
  taskPhaseLabel,
  type BackgroundTask,
} from "@/lib/background-tasks-context";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import { loadJobCards } from "@/lib/job-cards";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import {
  QUICK_SESSION_CARDS,
  QUICK_SESSION_MINUTES,
  type FreshRun,
  type UpNextCard,
  type UpNextRow,
} from "@/lib/up-next";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The card and rows resize on Home's curve when what they hold changes. */
const RESIZE = LinearTransition.duration(HOME_MOTION.duration).easing(HOME_MOTION.easing);

/**
 * New content in the card rises a few points into place as it fades in, after
 * the card has started to resize, so a change reads as one step, not a swap.
 */
function contentEntering(values: EntryAnimationsValues) {
  "worklet";
  void values;
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: {
      opacity: withTiming(1, { duration: 240, easing: HOME_MOTION.easing }),
      transform: [{ translateY: withTiming(0, { duration: 320, easing: HOME_MOTION.easing }) }],
    },
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "made at 11:05", or "made yesterday" for a run from before midnight. */
function madeWhen(finishedAt: number): string {
  const made = new Date(finishedAt);
  const today = new Date();
  if (made.toDateString() !== today.toDateString()) return "made yesterday";
  return `made at ${made.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** First-card previews by job, kept so the card can show one the moment it changes. */
const previews = new Map<string, Promise<string | null>>();
const loadedPreviews = new Map<string, string | null>();

/**
 * Starts loading a run's first card as soon as it finishes, while its row still
 * says "Cards ready", so the card can change with the preview already there.
 */
export function preloadPreview(deckId: string, jobId: string) {
  void loadPreview({ deckId, jobId, deckName: "", cards: 0, finishedAt: 0 });
}

function loadPreview(run: FreshRun): Promise<string | null> {
  let pending = previews.get(run.jobId);
  if (!pending) {
    pending = loadJobCards(run.deckId, run.jobId, 1)
      .then((result) => {
        const card = result.cards[0];
        const text = card ? (card.type === "basic" ? card.front : card.cloze_text) : null;
        loadedPreviews.set(run.jobId, text ?? null);
        return text ?? null;
      })
      .catch(() => {
        // Try again next time rather than remembering a failure.
        previews.delete(run.jobId);
        return null;
      });
    previews.set(run.jobId, pending);
  }
  return pending;
}

/** The longest the card waits for a preview before changing without one. */
const PREVIEW_WAIT_MS = 1200;

function cardKey(card: UpNextCard): string {
  return card.kind === "fresh" ? `fresh-${card.run.jobId}` : card.kind;
}

/** A pill button in the card: the brand one starts something, the quiet one is the other way. */
function CardButton({
  label,
  icon,
  quiet = false,
  grow = false,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon?: IconName;
  quiet?: boolean;
  grow?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <PressableScale
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={[styles.button, quiet ? styles.buttonQuiet : styles.buttonBrand, grow && styles.grow]}
    >
      {icon ? <Icon name={icon} size={14} color={quiet ? colors.fgPrimary : colors.fgOnBrand} /> : null}
      <Text style={[styles.buttonLabel, quiet ? styles.buttonLabelQuiet : styles.buttonLabelBrand]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Today so far: a bar that fills to what's been reviewed, and a line saying how much. */
function DayProgress({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const target = total > 0 ? Math.min(1, done / total) : 0;
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(target, { duration: 700, easing: HOME_MOTION.easing });
  }, [fill, target]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View
      style={styles.progress}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={done > 0 ? `${done} done today` : "None done yet today"}
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <View style={styles.track}>
        <Animated.View style={[styles.trackFill, fillStyle]} />
      </View>
      <Text style={styles.progressText}>
        {done > 0 ? `${done} done today` : "None done yet today"}
      </Text>
    </View>
  );
}

/** The first card a run made, once it has loaded, so "learn these" shows what they are. */
function FreshPreview({ run }: { run: FreshRun }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cardFont = cardFontStyle(useCardFont());
  // Usually loaded already (the card waits for it), so it's there on first paint.
  const [text, setText] = useState<string | null>(() => loadedPreviews.get(run.jobId) ?? null);
  const preloaded = useRef(loadedPreviews.has(run.jobId));
  useEffect(() => {
    let current = true;
    void loadPreview(run).then((next) => {
      if (current) setText(next);
    });
    return () => {
      current = false;
    };
  }, [run]);
  if (!text) return null;
  return (
    <Animated.View entering={preloaded.current ? undefined : FadeIn.duration(220)} style={styles.peek}>
      <Text style={styles.peekLabel}>1 of {run.cards}</Text>
      <CardPreviewText
        text={text}
        lines={3}
        style={StyleSheet.flatten([styles.peekText, cardFont])}
      />
    </Animated.View>
  );
}

/**
 * Home's Up next card: the one thing to do now. Cards just made come first,
 * then today's study (with a short session when the day is long), then a
 * finished day. Changing from one to the next resizes the card on Home's curve
 * while the new content rises in.
 */
export function UpNextCardView({
  card,
  compact = false,
}: {
  card: UpNextCard;
  /** A short phone: the card leaves out the preview of the first new card. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // A change to cards just made waits (briefly) for its first card's preview,
  // so the card changes once with the preview in place rather than growing again.
  const [shown, setShown] = useState(card);
  useEffect(() => {
    if (cardKey(card) === cardKey(shown) || card.kind !== "fresh" || compact) {
      setShown(card);
      return;
    }
    let done = false;
    const swap = () => {
      if (done) return;
      done = true;
      setShown(card);
    };
    void loadPreview(card.run).finally(swap);
    const timer = setTimeout(swap, PREVIEW_WAIT_MS);
    return () => {
      done = true;
      clearTimeout(timer);
    };
    // `shown` is only compared, not followed: a new `card` is what starts a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, compact]);

  let body: React.ReactNode;
  if (shown.kind === "fresh") {
    const { run } = shown;
    body = (
      <>
        <Text style={[styles.eyebrow, styles.eyebrowFresh]}>Up next · {madeWhen(run.finishedAt)}</Text>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Learn your {plural(run.cards, "new card")}
          </Text>
          <Text style={styles.detail} numberOfLines={2}>
            {run.deckName} · about {shown.minutes}
          </Text>
        </View>
        {compact ? null : <FreshPreview run={run} />}
        <View style={styles.buttons}>
          <CardButton
            label="Learn now"
            grow
            onPress={() =>
              router.push({ pathname: "/study/[deckId]", params: { deckId: run.deckId } })
            }
          />
          <CardButton
            label="Check cards"
            quiet
            accessibilityHint="Read, edit or remove the new cards first"
            onPress={() =>
              router.push({
                pathname: "/home/review",
                params: { deck: run.deckId, job: run.jobId, name: run.deckName },
              })
            }
          />
        </View>
      </>
    );
  } else if (shown.kind === "study") {
    body = (
      <>
        <Text style={styles.eyebrow}>Up next</Text>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {shown.title}
          </Text>
          <Text style={styles.detail} numberOfLines={2}>
            {shown.detail}
          </Text>
        </View>
        <DayProgress done={shown.done} total={shown.total} />
        <View style={styles.buttons}>
          <CardButton label="Start" icon="play" grow onPress={() => router.push("/study/all")} />
          {shown.quick ? (
            <CardButton
              label={`${QUICK_SESSION_MINUTES} min`}
              quiet
              accessibilityHint={`A short session of about ${QUICK_SESSION_CARDS} cards`}
              onPress={() =>
                router.push({ pathname: "/study/all", params: { goal: String(QUICK_SESSION_CARDS) } })
              }
            />
          ) : null}
        </View>
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.doneHeading}>
          <View style={styles.doneMark}>
            <Icon name="check" size={18} color={colors.accentInk} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {shown.title}
          </Text>
        </View>
        <Text style={styles.detail}>{shown.detail}</Text>
        <View style={styles.buttons}>
          <CardButton label="See your week" quiet onPress={() => router.navigate("/insights")} />
        </View>
      </>
    );
  }

  return (
    <Animated.View layout={RESIZE} style={styles.card}>
      <Animated.View key={cardKey(shown)} entering={contentEntering} style={styles.cardBody}>
        {body}
      </Animated.View>
    </Animated.View>
  );
}

/** A small ring that fills with the run's progress, a spark breathing inside it. */
function MakingRing({ progress }: { progress: number }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const size = 30;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = useSharedValue(0);
  const glow = useSharedValue(1);
  useEffect(() => {
    // Never quite empty, so the ring reads as started from the first moment.
    filled.value = withTiming(Math.max(0.06, Math.min(progress, 100) / 100), {
      duration: 600,
      easing: HOME_MOTION.easing,
    });
  }, [filled, progress]);
  useEffect(() => {
    if (reduceMotion) return;
    glow.value = withRepeat(
      withSequence(withTiming(0.45, { duration: 800 }), withTiming(1, { duration: 800 })),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
  }, [glow, reduceMotion]);
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - filled.value),
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.line} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={ringProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Animated.View style={glowStyle}>
        <Icon name="sparkles" size={13} color={colors.accent} />
      </Animated.View>
    </View>
  );
}

/** Cards being made: one quiet line, so studying can carry on beside it. */
function MakingRow({ task }: { task: BackgroundTask }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // The estimate moves about as the run's pace changes; the row only ever
  // counts down, so it never says "~14s left" and then "~38s left".
  const finishBy = useRef<number | null>(null);
  const estimate = estimateTaskEtaMs(task);
  const now = Date.now();
  if (estimate != null) {
    const by = now + estimate;
    finishBy.current = finishBy.current == null ? by : Math.min(finishBy.current, by);
  }
  const eta = finishBy.current == null ? null : finishBy.current - now;
  const deck = task.deckName ?? "your deck";
  const ready = task.status === "ready";
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${ready ? "Cards ready" : "Making cards"} for ${deck}. ${taskPhaseLabel(task)}`}
      accessibilityLiveRegion="polite"
    >
      <MakingRing progress={ready ? 100 : task.progress} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {ready ? "Cards ready" : "Making cards"}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {deck}
        </Text>
      </View>
      <Text style={styles.rowAside}>
        {ready
          ? taskPhaseLabel(task)
          : eta == null
            ? taskPhaseLabel(task)
            : eta > 1500
              ? formatTaskEta(eta)
              : "Almost done"}
      </Text>
    </View>
  );
}

/** A run that failed: why, and a way to have another go with the same text. */
function FailedRow({
  task,
  onRetry,
  onDismiss,
}: {
  task: BackgroundTask;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={[styles.rowMark, { backgroundColor: colors.dangerSoft }]}>
        <Icon name="warning" size={15} color={colors.danger} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          Couldn't make cards
        </Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {task.error ?? task.deckName ?? "Something went wrong"}
        </Text>
      </View>
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityRole="button"
        style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
      >
        <Text style={styles.rowActionText}>Try again</Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={({ pressed }) => [styles.rowClose, pressed && styles.pressed]}
      >
        <Icon name="close" size={14} color={colors.fgTertiary} />
      </Pressable>
    </View>
  );
}

function LinkRow({ row }: { row: Extract<UpNextRow, { kind: "link" }> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const icon: IconName = row.tone === "study" ? "play" : row.tone === "exam" ? "calendar" : "layers";
  return (
    <PressableScale
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.detail}`}
      onPress={() => {
        haptics.light();
        router.push(row.href);
      }}
      style={styles.row}
    >
      <View
        style={[
          styles.rowMark,
          {
            backgroundColor:
              row.tone === "exam" ? colors.dueSoft : row.tone === "study" ? colors.accent : colors.accentSoft,
          },
        ]}
      >
        <Icon
          name={icon}
          size={row.tone === "study" ? 12 : 15}
          color={row.tone === "exam" ? colors.due : row.tone === "study" ? colors.fgOnBrand : colors.accentInk}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.title}
        </Text>
        {row.progress != null ? (
          <View style={styles.rowTrack}>
            <View style={[styles.trackFill, { width: `${Math.round(row.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.rowAside, row.tone === "exam" && { color: colors.due }]} numberOfLines={1}>
        {row.detail}
      </Text>
      <Icon name="arrowRightSmall" size={14} color={colors.fgTertiary} />
    </PressableScale>
  );
}

/**
 * What comes after the card: cards being made (which turn into the card when
 * they're done), a failed run, and other ways into today's study. Rows slide
 * into place as others come and go.
 */
export function UpNextRows({
  rows,
  onRetry,
  onDismiss,
}: {
  rows: UpNextRow[];
  onRetry: (task: BackgroundTask) => void;
  onDismiss: (task: BackgroundTask) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (rows.length === 0) return null;
  return (
    <Animated.View layout={RESIZE} style={styles.rows}>
      {rows.map((row, index) => (
        <Animated.View
          key={row.key}
          entering={FadeIn.duration(220).delay(60)}
          exiting={FadeOut.duration(160)}
          layout={RESIZE}
          style={index > 0 && styles.rowLine}
        >
          {row.kind === "making" ? (
            <MakingRow task={row.task} />
          ) : row.kind === "failed" ? (
            <FailedRow task={row.task} onRetry={() => onRetry(row.task)} onDismiss={() => onDismiss(row.task)} />
          ) : (
            <LinkRow row={row} />
          )}
        </Animated.View>
      ))}
    </Animated.View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      borderRadius: 26,
      backgroundColor: colors.bgSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      overflow: "hidden",
    },
    cardBody: { padding: 20, gap: 14 },
    eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.fgTertiary },
    eyebrowFresh: { color: colors.accentInk },
    heading: { gap: 4 },
    title: {
      ...serifFont(),
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.3,
      color: colors.fgPrimary,
      flexShrink: 1,
    },
    detail: { fontSize: 15, lineHeight: 20, color: colors.fgSecondary },
    doneHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    doneMark: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    progress: { gap: 6 },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.bgActive, overflow: "hidden" },
    trackFill: { height: "100%", borderRadius: 3, backgroundColor: colors.accent },
    progressText: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
    peek: { gap: 6, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: colors.bgSunken },
    peekLabel: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
    // Family comes from the card font setting, as in study.
    peekText: { fontSize: 17, lineHeight: 23, color: colors.fgPrimary },
    buttons: { flexDirection: "row", gap: 10 },
    grow: { flex: 1 },
    button: {
      minHeight: 50,
      paddingHorizontal: 20,
      borderRadius: 25,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    buttonBrand: { backgroundColor: colors.actionBrandBg },
    buttonQuiet: { backgroundColor: colors.bgActive },
    buttonLabel: { fontSize: 16, lineHeight: 21 },
    buttonLabelBrand: { fontWeight: "600", color: colors.fgOnBrand },
    buttonLabelQuiet: { fontWeight: "500", color: colors.fgPrimary },
    rows: { paddingHorizontal: 8 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 8 },
    rowMark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    rowText: { flex: 1, minWidth: 0, gap: 4 },
    rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500", color: colors.fgPrimary },
    rowDetail: { fontSize: 13, lineHeight: 17, color: colors.fgTertiary, marginTop: -3 },
    rowTrack: { height: 3, borderRadius: 2, backgroundColor: colors.bgActive, overflow: "hidden", maxWidth: 120 },
    rowAside: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    rowAction: { minHeight: 32, justifyContent: "center" },
    rowActionText: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: colors.accentInk },
    rowClose: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.6 },
  });
}
