import type { ExamSummaryDto } from "@deephaus/api-client";
import {
  cardCount,
  finishCopy,
  finishEstimate,
  finishPlan,
  foldLeft,
  learnMoreChoices,
  learnMoreLimit,
  lookOverAnswers,
  summarizeAnswers,
  type FinishGradeCounts,
  type FinishPlan,
  type FinishSession,
  type SittingDeck,
  type StudyFinishDeck,
  type StudyQueueOptions,
} from "@deephaus/shared";
import { router, type Href } from "expo-router";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REVIEW_GRADES, gradeColor } from "@/components/study/review-dock";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { NativeSheet } from "@/components/ui/native-sheet";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { deckDisplayName } from "@/lib/deck-name";
import { formatRecall, formatSessionTime } from "@/lib/exams";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { openSection } from "@/lib/sections";
import { readyExams } from "@/lib/study/session";
import { studySitting } from "@/lib/study/sitting";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** The dock ignores taps this long, so a double tap on a grade can't start the next deck. */
const INPUT_GUARD_MS = 600;
/** The page opens without what's left rather than wait longer than this. */
const LOAD_TIMEOUT_MS = 6_000;

type FinishData = { decks: StudyFinishDeck[] | null; exams: ExamSummaryDto[]; streak?: number };

async function loadFinish(): Promise<FinishData> {
  const [finish, exams, stats] = await Promise.all([
    offlineData.getStudyFinish().catch(() => null),
    offlineData.listExams().catch(() => null),
    offlineData.getDashboardStats().catch(() => null),
  ]);
  return {
    decks: finish?.decks ?? null,
    exams: readyExams(exams?.exams ?? []),
    streak: stats?.streak,
  };
}

/** Options as route parameters, which the study screens read back. */
function optionParams(options: StudyQueueOptions): Record<string, string> {
  return {
    ...(options.newLimit != null ? { newLimit: String(options.newLimit) } : {}),
    ...(options.allReviews ? { allReviews: "1" } : {}),
    ...(options.ahead ? { ahead: "1" } : {}),
    ...(options.learning ? { learning: "1" } : {}),
  };
}

function deckHref(deckId: string, options: StudyQueueOptions = {}): Href {
  return { pathname: "/study/[deckId]", params: { deckId, ...optionParams(options) } };
}

function allHref(options: StudyQueueOptions = {}): Href {
  return { pathname: "/study/all", params: optionParams(options) };
}

function examHref(examId: string): Href {
  return { pathname: "/study/exam/[examId]", params: { examId } };
}

/** "Parent::Leaf" decks read by their leaf, as everywhere else on the phone. */
function plainDecks(decks: StudyFinishDeck[] | null): StudyFinishDeck[] | null {
  return decks?.map((deck) => ({ ...deck, title: deckDisplayName(deck.title) })) ?? null;
}

/**
 * The end of a session: what was done, what is left today, and one button for
 * what comes next, where the grades were. The rules are finishPlan's, in
 * @deephaus/shared; the web draws the same plan.
 */
export function SessionFinish({
  session,
  sessionKey,
  name,
  remaining,
  exam,
  examStart,
  skipped,
  nextReadyAt,
  mediaDeferred,
  backFallback,
  onResume,
  onReload,
  onLookOver,
  onDeckSettings,
}: {
  session: FinishSession;
  /** Picks this session's answers out of the sitting. */
  sessionKey: string;
  name: string;
  /** Cards left in a short session that stopped at its goal. */
  remaining: number;
  exam: ExamSummaryDto | null;
  /** Predicted recall when the exam's session began. */
  examStart: number | null;
  skipped: number;
  nextReadyAt: string | null;
  mediaDeferred: number;
  backFallback: Href;
  onResume: () => void;
  onReload: () => void;
  /** Shows the missed cards again; "sitting" is every one since study began, "deck" this deck's. */
  onLookOver: (scope: "session" | "sitting" | "deck") => void;
  onDeckSettings?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<FinishData | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [amount, setAmount] = useState(10);
  const readyAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const settle = (value: FinishData) => {
      if (!cancelled) setData((current) => current ?? value);
    };
    const timer = setTimeout(() => settle({ decks: null, exams: [] }), LOAD_TIMEOUT_MS);
    void loadFinish()
      .then(settle)
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const own = useMemo(() => summarizeAnswers(studySitting.session(sessionKey)), [sessionKey]);
  const sitting = useMemo(() => summarizeAnswers(studySitting.all()), []);

  const plan = useMemo(
    () =>
      data
        ? finishPlan({
            session,
            reviewed: own.cards,
            newLearned: own.newCards,
            remaining,
            decks: plainDecks(data.decks),
            exams: data.exams.map((entry) => ({
              id: entry.id,
              name: entry.name.trim() || "Your exam",
              ready: entry.ready_now,
            })),
          })
        : null,
    [data, own, remaining, session],
  );
  // What the extras' "Look over missed cards" covers.
  const poolMisses = useMemo(
    () => summarizeAnswers(lookOverAnswers(studySitting.all(), session, plan?.state)).misses.length,
    [session, plan?.state],
  );

  const finished = plan?.state === "done";
  useEffect(() => {
    if (!plan) return;
    readyAt.current = Date.now() + INPUT_GUARD_MS;
    if (finished) haptics.success();
    // Once, when the page first has something to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan !== null]);

  if (!plan) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Once the day is done the page adds up the whole sitting.
  const summary = finished ? sitting : own;
  const leave = () => goBackOrReplace(backFallback);
  const go = (href: Href) => router.replace(href);
  const goDeck = (deckId: string, options: StudyQueueOptions = {}) => {
    // Replacing a route with itself does nothing, so the same session starts over.
    const same =
      session.kind === "deck" &&
      session.id === deckId &&
      JSON.stringify(optionParams(session.options)) === JSON.stringify(optionParams(options));
    if (same) onReload();
    else go(deckHref(deckId, options));
  };
  const guarded = (run: () => void) => () => {
    if (Date.now() < readyAt.current) return;
    haptics.light();
    run();
  };

  const over = exam != null && exam.status !== "active";
  const nextAt =
    [nextReadyAt, exam?.next_session_at ?? null].find(
      (at): at is string => at != null && Date.parse(at) > Date.now() + 60_000,
    ) ?? null;
  const copy = over
    ? {
        title: "No session to study",
        subtitle:
          exam.status === "archived"
            ? "This exam is archived, so it has no sessions."
            : "This exam's date has passed, so it has no more sessions.",
      }
    : finishCopy({
        plan,
        session,
        summary,
        name,
        streak: data?.streak,
        formatTime: (iso) => formatSessionTime(iso),
        exam: exam ? { daysLeft: daysUntil(exam.exam_at), nextAt } : null,
      });

  // An exam has its own rows; more of a deck isn't more of the exam.
  const extrasInline =
    session.kind !== "exam" &&
    (plan.state === "empty" || plan.state === "learned" || plan.state === "ahead");

  const primary = primaryAction();
  const secondary = secondaryAction();

  function primaryAction(): { label: string; detail: string; run: () => void } {
    const next = plan!.next;
    if (!next || over) return { label: "Done", detail: "", run: leave };
    const detail = finishEstimate(next.cards);
    if (next.kind === "resume") return { label: "Keep going", detail, run: onResume };
    if (next.kind === "all") {
      return { label: "Study today's cards", detail, run: () => go(allHref()) };
    }
    if (next.kind === "exam") {
      return { label: `Study for ${next.title}`, detail, run: () => go(examHref(next.id)) };
    }
    return {
      label: next.id === session.id ? "Keep going" : `Study ${next.title}`,
      detail,
      run: () => goDeck(next.id),
    };
  }

  function secondaryAction(): { label: string; run: () => void } | null {
    const current = plan!;
    if (over) return null;
    if (current.state === "limit" && current.held) {
      const held = current.held;
      return {
        label: `Do the ${held.cards.toLocaleString()} now`,
        run: () => goDeck(held.deckId, { allReviews: true }),
      };
    }
    if (current.state === "returning" && current.returning) {
      const back = current.returning;
      return {
        label: back.cards === 1 ? "Finish it now" : `Finish the ${back.cards.toLocaleString()} now`,
        run: () =>
          back.deckId ? goDeck(back.deckId, { learning: true }) : go(allHref({ learning: true })),
      };
    }
    if (current.next) {
      return { label: current.state === "short" ? "Done for now" : "Done", run: leave };
    }
    if (session.kind === "exam" || current.state === "unknown") {
      return { label: "Check again", run: onReload };
    }
    const extras =
      current.extras.learn !== null ||
      current.extras.ahead !== null ||
      current.returning !== null ||
      poolMisses > 0;
    if (!extrasInline && extras) return { label: "Study more", run: () => setMoreOpen(true) };
    return null;
  }

  const missed = summary.misses.length;

  const extraRows = (inSheet: boolean) => {
    const rows: ReactNode[] = [];
    if (poolMisses > 0 && (inSheet || plan.state === "empty")) {
      rows.push(
        <FinishRow
          key="missed"
          icon="eye"
          title="Look over missed cards"
          detail="Nothing is rescheduled"
          end={cardCount(poolMisses)}
          onPress={() => {
            setMoreOpen(false);
            onLookOver(plan.state === "empty" && session.kind === "deck" ? "deck" : "sitting");
          }}
        />,
      );
    }
    const learn = plan.extras.learn;
    if (learn) {
      const choices = learnMoreChoices(learn.waiting);
      const chosen = choices.includes(amount) ? amount : (choices[choices.length - 1] ?? 0);
      rows.push(
        <View key="learn" style={styles.learn}>
          <View style={styles.learnTop}>
            <View style={styles.icon}>
              <Icon name="add" size={20} color={colors.accentInk} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Learn new cards</Text>
              <Text style={styles.rowDetail} numberOfLines={2}>
                {learn.waiting.toLocaleString()} waiting in {learn.title}. Just for today.
              </Text>
            </View>
          </View>
          <View style={styles.learnControls}>
            <View style={{ flex: 1 }}>
              <SegmentedControl
                accessibilityLabel="How many new cards"
                options={choices.map((count) => ({ value: String(count), label: String(count) }))}
                value={String(chosen)}
                onChange={(value) => setAmount(Number(value))}
              />
            </View>
            <Button
              variant="brand"
              size="sm"
              label="Start"
              onPress={() => {
                setMoreOpen(false);
                goDeck(learn.deckId, { newLimit: learnMoreLimit(learn, chosen) });
              }}
            />
          </View>
        </View>,
      );
    }
    if (plan.held && plan.state !== "limit") {
      const held = plan.held;
      rows.push(
        <FinishRow
          key="held"
          icon="layers"
          title="Reviews past today's limit"
          detail="Your limit stays as it is"
          end={cardCount(held.cards)}
          onPress={() => {
            setMoreOpen(false);
            goDeck(held.deckId, { allReviews: true });
          }}
        />,
      );
    }
    if (plan.returning) {
      const back = plan.returning;
      rows.push(
        <FinishRow
          key="returning"
          icon="clock"
          title="Finish what you're learning"
          detail={`Back ${formatSessionTime(back.at)} otherwise`}
          end={cardCount(back.cards)}
          onPress={() => {
            setMoreOpen(false);
            if (back.deckId) goDeck(back.deckId, { learning: true });
            else go(allHref({ learning: true }));
          }}
        />,
      );
    }
    if (plan.extras.ahead) {
      const ahead = plan.extras.ahead;
      rows.push(
        <FinishRow
          key="ahead"
          icon="bolt"
          title="Study ahead"
          detail="Less useful than waiting"
          end={cardCount(ahead.cards)}
          onPress={() => {
            setMoreOpen(false);
            if (ahead.deckId) goDeck(ahead.deckId, { ahead: true });
            else go(allHref({ ahead: true }));
          }}
        />,
      );
    }
    rows.push(
      <FinishRow
        key="make"
        icon="document"
        title={session.kind === "deck" && name ? `Add cards to ${name}` : "Make new cards"}
        onPress={() => {
          setMoreOpen(false);
          leave();
          openSection(
            "home",
            session.kind === "deck" && session.id
              ? { deck: session.id, deckName: name }
              : { fresh: String(Date.now()) },
          );
        }}
      />,
    );
    return rows;
  };

  const folded = foldLeft(plan.left, extrasInline ? 2 : undefined);
  const leftRows = folded.rows.map((entry) => (
    <FinishRow
      key={`${entry.kind}-${entry.id}`}
      mark="open"
      title={entry.title}
      detail={entry.kind === "exam" ? "Exam" : `About ${finishEstimate(entry.cards)}`}
      end={cardCount(entry.cards)}
      due
      onPress={() => (entry.kind === "exam" ? go(examHref(entry.id)) : goDeck(entry.id))}
    />
  ));

  if (folded.more) {
    leftRows.push(
      <FinishRow
        key="more"
        icon="more"
        title={`${folded.more.count} more`}
        detail="See all your decks"
        end={cardCount(folded.more.cards)}
        onPress={() => {
          leave();
          openSection("decks");
        }}
      />,
    );
  }

  let section: { label: string; rows: ReactNode[] } | null;
  if (over) {
    section = null;
  } else if (extrasInline) {
    section = {
      label:
        plan.state === "empty" && session.kind === "deck" && name ? `More from ${name}` : "Study more",
      rows: extraRows(false),
    };
  } else if (session.kind === "exam" && exam) {
    section = { label: name, rows: [...examRows(exam, examStart, skipped), ...leftRows] };
  } else {
    section = { label: "Today", rows: [...deckRows(), ...leftRows, ...nextSteps()] };
  }

  function deckRows(): ReactNode[] {
    const left = new Set(plan!.left.map((entry) => entry.id));
    return sitting.decks
      .filter((deck) => !left.has(deck.id))
      .map((deck) => <DeckRow key={deck.id} deck={deck} plan={plan!} sessionId={session.id} />);
  }

  function nextSteps(): ReactNode[] {
    if (plan!.state === "limit" && onDeckSettings) {
      return [
        <FinishRow key="limit" icon="settings" title="Change the limit" onPress={onDeckSettings} />,
      ];
    }
    if (plan!.state === "seen-all" && session.id) {
      const deckId = session.id;
      return [
        <FinishRow
          key="exam"
          icon="calendar"
          title="Set an exam date"
          detail="Reviews get planned for it"
          onPress={() => {
            leave();
            router.push({ pathname: "/exams/create", params: { deck: deckId } });
          }}
        />,
        <FinishRow
          key="add"
          icon="document"
          title="Add more cards"
          detail="Your next chapter or notes"
          onPress={() => {
            leave();
            openSection("home", { deck: deckId, deckName: name });
          }}
        />,
      ];
    }
    return [];
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(320)}>
          <Text style={styles.title} accessibilityRole="header">
            {copy.title}
          </Text>
          {copy.subtitle ? <Text style={styles.subtitle}>{copy.subtitle}</Text> : null}

          {summary.cards > 0 && !over ? <GradeSplit first={summary.first} /> : null}
          {summary.cards > 0 && missed > 0 && !over ? (
            <View style={[styles.group, styles.missed]}>
              <FinishRow
                icon="eye"
                title={missed === 1 ? "Look over the one you missed" : `Look over the ${missed} you missed`}
                onPress={() => onLookOver(finished ? "sitting" : "session")}
              />
            </View>
          ) : null}

          {section && section.rows.length > 0 ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel} numberOfLines={1} accessibilityRole="header">
                  {section.label}
                </Text>
                {section.label === "Today" && plan.left.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={12}
                    onPress={() => go(allHref())}
                    style={({ pressed }) => pressed && { opacity: 0.5 }}
                  >
                    <Text style={styles.sectionAction}>
                      {plan.left.length === 2 ? "Study both" : `Study all ${plan.left.length}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <RowGroup rows={section.rows} />
            </>
          ) : null}

          {extrasInline && !over && leftRows.length > 0 ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel} accessibilityRole="header">
                  {session.kind === "deck" ? "Due in other decks" : "Due now"}
                </Text>
              </View>
              <RowGroup rows={leftRows} />
            </>
          ) : null}

          {mediaDeferred > 0 ? (
            <Text style={styles.note}>
              {cardCount(mediaDeferred)} {mediaDeferred === 1 ? "is" : "are"} waiting for media to
              download.
            </Text>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <PressableScale
          scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel={[primary.label, primary.detail].filter(Boolean).join(", ")}
          onPress={guarded(primary.run)}
          style={styles.primary}
        >
          <Text style={styles.primaryLabel} numberOfLines={1}>
            {primary.label}
          </Text>
          {primary.detail ? <Text style={styles.primaryDetail}>{primary.detail}</Text> : null}
        </PressableScale>
        {secondary ? (
          <Pressable
            accessibilityRole="button"
            onPress={guarded(secondary.run)}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.5 }]}
          >
            <Text style={styles.secondaryLabel}>{secondary.label}</Text>
          </Pressable>
        ) : null}
      </View>

      <NativeSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Study more"
        detents={[{ height: 470 }, "large"]}
      >
        <ScrollView contentContainerStyle={styles.sheet}>
          <Text style={styles.sheetNote}>
            Everything due now is finished.
            {plan.tomorrow ? ` Tomorrow has ${cardCount(plan.tomorrow)}.` : ""}
          </Text>
          <RowGroup rows={extraRows(true)} />
        </ScrollView>
      </NativeSheet>
    </View>
  );
}

function daysUntil(iso: string): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((day(at) - day(new Date())) / 86_400_000);
}

function examRows(exam: ExamSummaryDto, start: number | null, skipped: number): ReactNode[] {
  const now = exam.snapshot.recall_now;
  const rose = start != null && formatRecall(start) !== formatRecall(now) && now > start;
  const rows: ReactNode[] = [
    <FinishRow
      key="recall"
      icon="lineChart"
      title="If it were today"
      detail={`${rose ? `Up from ${formatRecall(start)}. ` : ""}Target ${formatRecall(exam.target_recall)}.`}
      end={formatRecall(now)}
    />,
  ];
  if (skipped > 0) {
    rows.push(
      <FinishRow
        key="skipped"
        icon="clock"
        title={`${cardCount(skipped)} left out`}
        detail="Today's study time for this exam is used up"
      />,
    );
  }
  return rows;
}

function DeckRow({
  deck,
  plan,
  sessionId,
}: {
  deck: SittingDeck;
  plan: FinishPlan;
  sessionId?: string;
}) {
  const title = deckDisplayName(deck.name);
  if (plan.state === "returning" && plan.returning && deck.id === sessionId) {
    return (
      <FinishRow
        icon="clock"
        title={title}
        detail={`${cardCount(plan.returning.cards)} still being learned`}
        end={formatSessionTime(plan.returning.at).replace(/^at /, "")}
      />
    );
  }
  if (plan.state === "limit" && plan.held && deck.id === plan.held.deckId) {
    return (
      <FinishRow
        icon="layers"
        title={title}
        detail={`Daily limit of ${(plan.held.limit ?? 0).toLocaleString()}`}
        end={`${plan.held.cards.toLocaleString()} left`}
      />
    );
  }
  return (
    <FinishRow
      mark="done"
      title={title}
      detail={`${deck.knew.toLocaleString()} of ${deck.cards.toLocaleString()} first time${
        plan.returning && plan.returning.deckId === deck.id
          ? `. ${plan.returning.cards.toLocaleString()} back ${formatSessionTime(plan.returning.at)}`
          : ""
      }`}
      end="Done"
    />
  );
}

function GradeSplit({ first }: { first: FinishGradeCounts }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View
      accessible
      accessibilityLabel={REVIEW_GRADES.map((grade) => `${grade.label} ${first[grade.id]}`).join(", ")}
    >
      <View style={styles.bar}>
        {REVIEW_GRADES.filter((grade) => first[grade.id] > 0).map((grade) => (
          <View
            key={grade.id}
            style={{ flex: first[grade.id], backgroundColor: gradeColor(colors, grade.id) }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {REVIEW_GRADES.map((grade) => (
          <View key={grade.id} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: gradeColor(colors, grade.id) }]} />
            <Text style={styles.legendLabel}>
              {grade.label} <Text style={styles.legendValue}>{first[grade.id]}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RowGroup({ rows }: { rows: ReactNode[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

function FinishRow({
  icon,
  mark,
  title,
  detail,
  end,
  due = false,
  onPress,
}: {
  icon?: IconName;
  /** A deck's circle: ticked once done. */
  mark?: "done" | "open";
  title: string;
  detail?: string;
  end?: string;
  due?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessible
      accessibilityLabel={[title, detail, end].filter(Boolean).join(", ")}
      onPress={() => {
        haptics.selection();
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgHover }]}
    >
      <View
        style={[
          styles.icon,
          mark === "open" && styles.markOpen,
          mark === "done" && styles.markDone,
        ]}
      >
        {mark === "done" ? (
          <Icon name="check" size={14} color={colors.fgOnBrand} />
        ) : icon ? (
          <Icon name={icon} size={20} color={colors.accentInk} />
        ) : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {end ? <Text style={[styles.rowEnd, due && styles.rowDue]}>{end}</Text> : null}
      {onPress ? <Icon name="arrowRightSmall" size={14} color={colors.fgDisabled} /> : null}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
    title: {
      ...serifFont(),
      fontSize: 33,
      lineHeight: 39,
      letterSpacing: -0.4,
      color: colors.fgPrimary,
    },
    subtitle: { marginTop: 8, fontSize: 16, lineHeight: 22, color: colors.fgSecondary },
    bar: {
      flexDirection: "row",
      gap: 2,
      height: 8,
      marginTop: 20,
      borderRadius: 4,
      overflow: "hidden",
    },
    legend: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      columnGap: 10,
      rowGap: 4,
      marginTop: 9,
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    swatch: { width: 9, height: 9, borderRadius: 2 },
    legendLabel: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    legendValue: { fontWeight: "600", color: colors.fgPrimary },
    missed: { marginTop: 16 },
    sectionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginTop: 24,
      marginBottom: 8,
      marginHorizontal: 4,
    },
    sectionLabel: { flexShrink: 1, fontSize: 14, lineHeight: 19, color: colors.fgTertiary },
    sectionAction: { fontSize: 14, lineHeight: 19, fontWeight: "600", color: colors.accentInk },
    group: {
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
      overflow: "hidden",
    },
    separator: { height: StyleSheet.hairlineWidth, marginLeft: 54, backgroundColor: colors.line },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 9,
    },
    icon: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
    markOpen: { borderRadius: 13, borderWidth: 1.5, borderColor: colors.lineStrong },
    markDone: { borderRadius: 13, backgroundColor: colors.accent },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: "500", color: colors.fgPrimary },
    rowDetail: { fontSize: 13.5, lineHeight: 18, color: colors.fgTertiary },
    rowEnd: {
      fontSize: 14.5,
      lineHeight: 20,
      color: colors.fgTertiary,
      fontVariant: ["tabular-nums"],
    },
    rowDue: { fontWeight: "500", color: colors.due },
    learn: { paddingHorizontal: 16, paddingVertical: 11, gap: 10 },
    learnTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    learnControls: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 38 },
    note: { marginTop: 16, fontSize: 13, lineHeight: 19, textAlign: "center", color: colors.fgTertiary },
    dock: { paddingHorizontal: 20, paddingTop: 8, gap: 2 },
    primary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 56,
      paddingHorizontal: 20,
      borderRadius: radius.pill,
      backgroundColor: colors.actionPrimaryBg,
    },
    primaryLabel: {
      flexShrink: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.actionPrimaryFg,
    },
    primaryDetail: { fontSize: 15, lineHeight: 20, color: colors.actionPrimaryFg, opacity: 0.8 },
    secondary: { minHeight: 46, alignItems: "center", justifyContent: "center" },
    secondaryLabel: { fontSize: 16, lineHeight: 21, fontWeight: "500", color: colors.fgPrimary },
    sheet: { paddingHorizontal: 16, paddingBottom: 28 },
    sheetNote: {
      marginBottom: 14,
      fontSize: 14,
      lineHeight: 19,
      textAlign: "center",
      color: colors.fgTertiary,
    },
  });
}
