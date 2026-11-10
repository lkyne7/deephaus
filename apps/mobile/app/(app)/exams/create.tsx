import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import type { ExamInsightDto, ExamSelectorOptions } from "@deephaus/api-client";
import { EXAM_DATE_ONLY_HOUR, EXAM_DEFAULT_TARGET } from "@deephaus/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { ExamStatRow } from "@/components/exams/stat-row";
import { OfflineNotice } from "@/components/offline-notice";
import { Button } from "@/components/ui/button";
import { DeckSelect } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { deckDisplayName } from "@/lib/deck-name";
import { api } from "@/lib/api";
import {
  dailyCapLabel,
  deviceTimeZone,
  formatExamDate,
  formatMinutes,
  formatRecall,
} from "@/lib/exams";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

const CUSTOM_DATE = "custom";

const DATE_CHOICES = [
  { id: "3", label: "In 3 days" },
  { id: "7", label: "In 1 week" },
  { id: "14", label: "In 2 weeks" },
  { id: "30", label: "In 1 month" },
  { id: "60", label: "In 2 months" },
  { id: CUSTOM_DATE, label: "Pick a date" },
];

const TARGET_CHOICES = [
  { value: "0.8", label: "80%" },
  { value: "0.85", label: "85%" },
  { value: "0.9", label: "90%" },
  { value: "0.95", label: "95%" },
];

const NO_LIMIT = "none";
// The same daily budgets the exam's time-versus-score choices offer later.
const CAP_MINUTES = [10, 20, 30, 45, 60];
const CAP_CHOICES = [
  { id: NO_LIMIT, label: dailyCapLabel(null) },
  ...CAP_MINUTES.map((minutes) => ({ id: String(minutes), label: dailyCapLabel(minutes) })),
];

const PREVIEW_DELAY_MS = 400;

function dayFromOffset(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function defaultTime(): Date {
  const time = new Date();
  time.setHours(EXAM_DATE_ONLY_HOUR, 0, 0, 0);
  return time;
}

/**
 * The exam's instant: the chosen time, or the shared morning hour when none is
 * set, so the plan is finished before the earliest the exam could be.
 */
function examInstant(day: Date, time: Date | null): Date {
  const date = new Date(day);
  if (time) date.setHours(time.getHours(), time.getMinutes(), 0, 0);
  else date.setHours(EXAM_DATE_ONLY_HOUR, 0, 0, 0);
  return date;
}

export default function CreateExamScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const online = useOnline();
  // "Add exam" on a deck opens this screen with that deck already chosen.
  const { deck: presetDeck } = useLocalSearchParams<{ deck?: string }>();
  const [options, setOptions] = useState<ExamSelectorOptions["options"] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(
    () => new Set(typeof presetDeck === "string" && presetDeck ? [presetDeck] : []),
  );
  const [offsetDays, setOffsetDays] = useState(7);
  const [customDay, setCustomDay] = useState<Date | null>(null);
  const [time, setTime] = useState<Date | null>(null);
  const [target, setTarget] = useState(EXAM_DEFAULT_TARGET);
  const [capMinutes, setCapMinutes] = useState<number | null>(null);
  const [preview, setPreview] = useState<ExamInsightDto | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const previewRequest = useRef(0);
  const timeZone = useMemo(() => deviceTimeZone(), []);

  // Deck choices come from the server; load them again when a connection returns.
  useEffect(() => {
    if (!online || options) return;
    let cancelled = false;
    setOptionsError(null);
    void api
      .getExamOptions()
      .then((result) => {
        if (cancelled) return;
        setOptions(result.options);
        // A deck passed in that can't be chosen here (no cards, or gone) would
        // stay selected with no row to untick it.
        const offered = new Set(result.options.decks.map((deck) => deck.id));
        setSelectedDecks((prev) => {
          const kept = [...prev].filter((id) => offered.has(id));
          return kept.length === prev.size ? prev : new Set(kept);
        });
      })
      .catch((e) => {
        if (!cancelled) setOptionsError(e instanceof Error ? e.message : "Could not load decks.");
      });
    return () => {
      cancelled = true;
    };
  }, [online, options]);

  const selectedCardCount = useMemo(() => {
    if (!options) return 0;
    return options.decks
      .filter((deck) => selectedDecks.has(deck.id))
      .reduce((sum, deck) => sum + deck.card_count, 0);
  }, [options, selectedDecks]);

  function toggleDeck(id: string) {
    setSelectedDecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const day = customDay ?? dayFromOffset(offsetDays);
  const examAt = examInstant(day, time);
  // To the minute, so a re-render doesn't count as a new date.
  const examAtIso = new Date(Math.floor(examAt.getTime() / 60_000) * 60_000).toISOString();
  const inFuture = examAt.getTime() > Date.now();
  const dateChoiceId = customDay ? CUSTOM_DATE : String(offsetDays);
  const dateChoice = DATE_CHOICES.find((choice) => choice.id === dateChoiceId);
  const capChoiceId = capMinutes == null ? NO_LIMIT : String(capMinutes);
  const deckIds = useMemo(() => Array.from(selectedDecks).sort(), [selectedDecks]);
  const deckKey = deckIds.join(",");
  const canCreate =
    online &&
    name.trim().length > 0 &&
    deckIds.length > 0 &&
    selectedCardCount > 0 &&
    inFuture &&
    !creating;

  // What this exam would ask for and reach, before it is saved.
  useEffect(() => {
    const request = ++previewRequest.current;
    if (!online || deckIds.length === 0 || !inFuture) {
      setPreview(null);
      setPreviewError(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(() => {
      void api
        .previewExam({
          exam_at: examAtIso,
          timezone: timeZone,
          target_recall: target,
          daily_minutes_cap: capMinutes,
          deck_ids: deckIds,
        })
        .then((result) => {
          if (request !== previewRequest.current) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((e) => {
          if (request !== previewRequest.current) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "Could not work out a preview.");
        })
        .finally(() => {
          if (request === previewRequest.current) setPreviewing(false);
        });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // deckKey stands in for deckIds, which is a new array on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, deckKey, examAtIso, inFuture, target, capMinutes, timeZone]);

  function selectDate(id: string) {
    if (id !== CUSTOM_DATE) {
      setCustomDay(null);
      setOffsetDays(Number(id));
      return;
    }
    const initial = customDay ?? dayFromOffset(offsetDays);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial,
        mode: "date",
        minimumDate: new Date(),
        onChange: (event, date) => {
          if (event.type === "set" && date) setCustomDay(date);
        },
      });
    } else {
      setCustomDay(initial);
    }
  }

  function openAndroidTime(initial: Date) {
    DateTimePickerAndroid.open({
      value: initial,
      mode: "time",
      onChange: (event, date) => {
        if (event.type === "set" && date) setTime(date);
      },
    });
  }

  function toggleTime(enabled: boolean) {
    if (!enabled) {
      setTime(null);
      return;
    }
    const initial = defaultTime();
    setTime(initial);
    if (Platform.OS === "android") openAndroidTime(initial);
  }

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const detail = await api.createExam({
        name: name.trim(),
        exam_at: examAt.toISOString(),
        timezone: timeZone,
        has_time: time != null,
        target_recall: target,
        daily_minutes_cap: capMinutes,
        deck_ids: deckIds,
      });
      router.replace(`/exams/${detail.exam.id}`);
    } catch (e) {
      Alert.alert("Could not add exam", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  // Nothing here works without the server's deck list.
  if (!online && !options) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="New exam" backFallback="/exams" />
        <ScrollView contentInsetAdjustmentBehavior="automatic">
          <OfflineNotice feature="Creating an exam" />
        </ScrollView>
      </View>
    );
  }

  // The name field takes focus at once, so the screen makes room for the
  // keyboard itself and a drag puts the keyboard away. The list's own keyboard
  // insets are not used: under the clear bar they scroll "Which exam is it?"
  // beneath the bar whenever the keyboard opens.
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader title="New exam" backFallback="/exams" />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Which exam is it?
          </Text>
          <Field
            accessibilityLabel="Exam name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Biology final"
            maxLength={120}
            autoFocus
          />
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            When is it?
          </Text>
          <DeckSelect
            title="Exam date"
            value={dateChoice?.label ?? ""}
            options={DATE_CHOICES}
            selectedId={dateChoiceId}
            onSelect={(choice) => selectDate(choice.id)}
          />
          <View style={styles.group}>
            {customDay && Platform.OS === "ios" ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Date</Text>
                <DateTimePicker
                  value={customDay}
                  mode="date"
                  display="compact"
                  accentColor={colors.accent}
                  minimumDate={new Date()}
                  onChange={(_event, date) => {
                    if (date) setCustomDay(date);
                  }}
                />
              </View>
            ) : null}
            <View style={[styles.row, customDay && Platform.OS === "ios" && styles.rowLine]}>
              <Text style={styles.rowLabel}>Set a time</Text>
              <Switch
                value={time != null}
                onValueChange={toggleTime}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Set a time"
              />
            </View>
            {time ? (
              <View style={[styles.row, styles.rowLine]}>
                <Text style={styles.rowLabel}>Time</Text>
                {Platform.OS === "ios" ? (
                  <DateTimePicker
                    value={time}
                    mode="time"
                    display="compact"
                    accentColor={colors.accent}
                    onChange={(_event, date) => {
                      if (date) setTime(date);
                    }}
                  />
                ) : (
                  <Pressable
                    onPress={() => openAndroidTime(time)}
                    accessibilityRole="button"
                    accessibilityLabel="Change time"
                    hitSlop={8}
                  >
                    <Text style={styles.rowValue}>
                      {time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
          <Text style={styles.helper}>
            {inFuture
              ? formatExamDate({ exam_at: examAt.toISOString(), has_time: time != null })
              : "That time has already passed. Choose a later one."}
          </Text>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            What does it cover?
          </Text>
          {!options && !optionsError && (
            <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
          )}
          {optionsError && !options && (
            <View style={styles.inlineNote}>
              <FeaturedIcon icon="warning" variant="again" size="sm" />
              <Text style={styles.inlineNoteText}>{optionsError}</Text>
            </View>
          )}
          {options && options.decks.length === 0 && (
            <Text style={styles.helper}>
              You need at least one deck with cards to add an exam.
            </Text>
          )}
          {options && options.decks.length > 0 && (
            <View style={styles.group}>
              {options.decks.map((deck, index) => {
                const active = selectedDecks.has(deck.id);
                return (
                  <Pressable
                    key={deck.id}
                    onPress={() => toggleDeck(deck.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    style={({ pressed }) => [
                      styles.deckOption,
                      index > 0 && styles.rowLine,
                      pressed && styles.deckOptionPressed,
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.deckName} numberOfLines={1}>
                        {deckDisplayName(deck.name)}
                      </Text>
                      <Text style={styles.helper}>
                        {deck.card_count} card{deck.card_count === 1 ? "" : "s"}
                      </Text>
                    </View>
                    {active && <Icon name="check" size={20} color={colors.accent} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          {selectedDecks.size > 0 && (
            <Text style={styles.helper}>
              {selectedCardCount} card{selectedCardCount === 1 ? "" : "s"} selected
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            What are you aiming for?
          </Text>
          <Text style={styles.helper}>
            Target: the share of these cards you want to recall on the day.
          </Text>
          <SegmentedControl
            accessibilityLabel="Target recall"
            options={TARGET_CHOICES}
            value={String(target)}
            onChange={(next) => setTarget(Number(next))}
          />
          <Text style={[styles.helper, { marginTop: 6 }]}>Daily study time</Text>
          <DeckSelect
            title="Daily study time"
            value={dailyCapLabel(capMinutes)}
            options={CAP_CHOICES}
            selectedId={capChoiceId}
            onSelect={(choice) =>
              setCapMinutes(choice.id === NO_LIMIT ? null : Number(choice.id))
            }
          />
          <Text style={styles.helper}>
            {capMinutes == null
              ? "No limit: each day asks for as much as the plan needs."
              : `Each day stops at ${formatMinutes(capMinutes)}, even if the plan needs more.`}
          </Text>
        </View>

        {!online ? (
          <View style={styles.inlineNote}>
            <FeaturedIcon icon="cloudOffline" variant="gray" size="sm" />
            <Text style={styles.inlineNoteText}>
              You're offline. Creating an exam needs a connection.
            </Text>
          </View>
        ) : deckIds.length > 0 && inFuture ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              What this would take
            </Text>
            {preview ? (
              <>
                <ExamStatRow
                  style={previewing ? styles.stale : undefined}
                  stats={[
                    { label: "Cards", value: String(preview.snapshot.total) },
                    { label: "Not seen yet", value: String(preview.snapshot.unseen) },
                    {
                      label: "Needed a day",
                      value: formatMinutes(preview.plan.needed.typical_minutes),
                    },
                    {
                      label: "On track for",
                      value: formatRecall(preview.plan.projected.recall_at_exam),
                    },
                  ]}
                />
                {preview.snapshot.total === 0 ? (
                  <Text style={styles.helper}>These decks have no cards to study.</Text>
                ) : !preview.plan.on_track ? (
                  <Text style={styles.helper}>
                    {capMinutes != null
                      ? `That is short of ${formatRecall(target)}. About ${formatMinutes(
                          preview.plan.needed.typical_minutes,
                        )} a day with no limit would get closer.`
                      : `That is short of ${formatRecall(target)} even with no limit. There may not be enough time before the exam.`}
                  </Text>
                ) : null}
              </>
            ) : previewError ? (
              <Text style={styles.helper}>{previewError}</Text>
            ) : (
              <ActivityIndicator color={colors.accent} style={{ paddingVertical: 12 }} />
            )}
          </View>
        ) : null}

        <Button
          variant="primary"
          size="xl"
          label={creating ? "Adding…" : "Add exam"}
          disabled={!canCreate}
          onPress={() => void create()}
          fullWidth
          style={{ marginTop: 4 }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 24 },
    section: {
      gap: 10,
    },
    sectionTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    helper: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    inlineNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    inlineNoteText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
    },
    group: {
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    rowLine: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    rowLabel: { fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    rowValue: { fontSize: 16, lineHeight: 21, color: colors.accentInk },
    deckOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    deckOptionPressed: {
      backgroundColor: colors.bgHover,
    },
    deckName: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    stale: { opacity: 0.55 },
  });
}
