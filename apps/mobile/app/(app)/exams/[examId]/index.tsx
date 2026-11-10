import type {
  ExamAction,
  ExamDeckBreakdownDto,
  ExamDetailDto,
  ExamPlanDto,
  UpdateExamBody,
} from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ExamStatRow } from "@/components/exams/stat-row";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { Field } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  ScreenHeader,
  type ScreenHeaderMenuAction,
} from "@/components/ui/screen-header";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { api } from "@/lib/api";
import { deckDisplayName } from "@/lib/deck-name";
import {
  dailyCapLabel,
  examCountdown,
  examStageLabel,
  formatExamDate,
  formatMinutes,
  formatPlanDay,
  formatRecall,
  isCramWindow,
  nextSessionLabel,
  readyLabel,
} from "@/lib/exams";
import { haptics } from "@/lib/haptics";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

/** Days of the plan shown before "Show all". */
const PLAN_DAYS_SHOWN = 7;

type CapChoice = { minutes: number | null; recall: number };

/** The plan's daily-time choices, with the exam's own limit added if it isn't one of them. */
function capChoices(plan: ExamPlanDto, currentCap: number | null): CapChoice[] {
  const choices = plan.curve.map((point) => ({
    minutes: point.minutes_per_day,
    recall: point.recall_at_exam,
  }));
  if (choices.length > 0 && !choices.some((choice) => choice.minutes === currentCap)) {
    choices.push({ minutes: currentCap, recall: plan.projected.recall_at_exam });
  }
  return choices.sort(
    (a, b) => (a.minutes ?? Number.MAX_SAFE_INTEGER) - (b.minutes ?? Number.MAX_SAFE_INTEGER),
  );
}

export default function ExamDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const online = useOnline();
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const [detail, setDetail] = useState<ExamDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The daily-time row being saved: a number, or "none" for no limit.
  const [savingCap, setSavingCap] = useState<number | "none" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [scoreDraft, setScoreDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);

  const load = useCallback(async () => {
    if (!examId) return;
    try {
      setError(null);
      setDetail(await offlineData.getExam(examId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this exam.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  // Loads on first show and again on every return (one load each time).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Exams are read-only offline, so say so before a change is attempted. */
  function requireConnection(): boolean {
    if (online) return true;
    Alert.alert("You're offline", "Changing an exam needs a connection.");
    return false;
  }

  async function update(body: UpdateExamBody, failure: string): Promise<boolean> {
    if (!examId || busy || !requireConnection()) return false;
    setBusy(true);
    try {
      setDetail(await api.updateExam(examId, body));
      haptics.success();
      return true;
    } catch (e) {
      Alert.alert(failure, e instanceof Error ? e.message : "Unknown error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: ExamAction) {
    if (!examId || busy || !requireConnection()) return;
    setBusy(true);
    try {
      setDetail(await api.runExamAction(examId, action));
      haptics.success();
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function chooseCap(minutes: number | null) {
    if (!detail || minutes === detail.exam.daily_minutes_cap) return;
    setSavingCap(minutes ?? "none");
    await update({ daily_minutes_cap: minutes }, "Could not change the daily time");
    setSavingCap(null);
  }

  async function runRename(nextName: string) {
    const next = nextName.trim();
    if (!next) {
      Alert.alert("Name required", "Enter a name for this exam.");
      return;
    }
    if (next === detail?.exam.name.trim()) return;
    await update({ name: next }, "Rename failed");
  }

  async function saveScore() {
    const value = Number(scoreDraft.replace(",", ".").trim());
    if (scoreDraft.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100) {
      Alert.alert("Enter a score", "Type your result as a number from 0 to 100.");
      return;
    }
    Keyboard.dismiss();
    if (await update({ result_score: value }, "Could not save your result")) {
      setEditingScore(false);
    }
  }

  function confirmDelete() {
    if (!examId || !detail || !requireConnection()) return;
    Alert.alert(
      "Delete exam",
      `"${detail.exam.name}" will be deleted. Your cards and their review history stay as they are.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await api.deleteExam(examId);
                goBackOrReplace("/exams");
              } catch (e) {
                Alert.alert("Delete failed", e instanceof Error ? e.message : "Unknown error");
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  function confirmLetGo() {
    if (!detail || !requireConnection()) return;
    const total = detail.snapshot.total;
    Alert.alert(
      "Let these cards go?",
      `${total} card${total === 1 ? "" : "s"} in this exam will be suspended and won't come up for review again. You can unsuspend them from Cards.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Let them go",
          style: "destructive",
          onPress: () => void runAction("suspend_cards"),
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Exam" backFallback="/exams" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Exam" backFallback="/exams" />
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="again" size="lg" />
          <Text style={styles.errorText}>{error ?? "Exam not found."}</Text>
          <Button
            variant="secondary"
            size="md"
            label="Try again"
            onPress={() => {
              setLoading(true);
              void load();
            }}
            style={{ marginTop: 12 }}
          />
        </View>
      </View>
    );
  }

  const { exam, snapshot, plan, decks } = detail;
  const active = exam.status === "active";
  const archived = exam.status === "archived";
  // Archived wins over the date, so check the date itself for what to show.
  const past = Date.parse(exam.exam_at) <= Date.now();
  const hasCards = snapshot.total > 0;
  const target = formatRecall(exam.target_recall);
  const choices = active && online && hasCards ? capChoices(plan, exam.daily_minutes_cap) : [];
  const uncapped = plan.curve.find((point) => point.minutes_per_day == null);
  const nextSession = nextSessionLabel(exam.next_session_at);
  const planDays = showAllDays ? plan.days : plan.days.slice(0, PLAN_DAYS_SHOWN);

  const manageItems: ScreenHeaderMenuAction[] = [
    {
      label: "Rename",
      sfIcon: "pencil",
      disabled: busy,
      onPress: () => setRenameOpen(true),
    },
    {
      label: archived ? "Unarchive" : "Archive",
      sfIcon: archived ? "tray.and.arrow.up" : "archivebox",
      disabled: busy,
      onPress: () => void runAction(archived ? "unarchive" : "archive"),
    },
    {
      label: "Delete",
      sfIcon: "trash",
      destructive: true,
      disabled: busy,
      onPress: confirmDelete,
    },
  ];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={exam.name}
        backFallback="/exams"
        actions={[
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Manage exam",
            items: manageItems,
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
      >
        <Card padding={16} style={{ gap: 14 }}>
          <View style={styles.statusRow}>
            <BadgePill
              label={archived ? "Archived" : examStageLabel(snapshot.stage)}
              tone={active ? "brand" : "gray"}
            />
            {active && isCramWindow(exam.exam_at) ? <BadgePill label="Cram" tone="orange" /> : null}
            <Text style={styles.dateText} numberOfLines={2}>
              {formatExamDate(exam)} · {examCountdown(exam.exam_at)}
            </Text>
          </View>

          {past ? (
            <View style={styles.headline}>
              <Headline value={hasCards ? formatRecall(snapshot.recall_now) : "–"} label="Predicted on the day" />
              <Headline
                value={exam.result_score == null ? "–" : `${Math.round(exam.result_score)}%`}
                label="Your result"
              />
            </View>
          ) : (
            <View style={styles.headline}>
              <Headline
                value={hasCards ? formatRecall(snapshot.recall_now) : "–"}
                label="If the exam were now"
              />
              <Headline
                value={hasCards ? formatRecall(plan.projected.recall_at_exam) : "–"}
                label="On track for"
              />
            </View>
          )}
          <Text style={styles.targetText}>Target {target}</Text>

          {active && hasCards && !plan.on_track ? (
            <View style={styles.warnBox}>
              <Icon name="warning" size={15} color={colors.fgSecondary} />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={styles.warnText}>
                  {exam.daily_minutes_cap != null
                    ? `Not on track. With ${dailyCapLabel(exam.daily_minutes_cap).toLowerCase()} you reach ${formatRecall(
                        plan.projected.recall_at_exam,
                      )}, short of ${target}. About ${formatMinutes(
                        plan.needed.typical_minutes,
                      )} a day with no limit would ${
                        uncapped == null
                          ? "get you closer"
                          : uncapped.recall_at_exam >= exam.target_recall - 0.005
                            ? "get you there"
                            : `reach ${formatRecall(uncapped.recall_at_exam)}`
                      }.`
                    : `Not on track. Even at about ${formatMinutes(
                        plan.needed.typical_minutes,
                      )} a day, the plan reaches ${formatRecall(
                        plan.projected.recall_at_exam,
                      )}, short of ${target}. There may not be enough time left before the exam.`}
                </Text>
                {exam.daily_minutes_cap != null && online ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Remove the daily limit"
                    disabled={busy}
                    onPress={() => void chooseCap(null)}
                    style={{ alignSelf: "flex-start" }}
                  />
                ) : null}
              </View>
            </View>
          ) : null}
        </Card>

        {hasCards ? (
          <ExamStatRow
            stats={[
              { label: "Cards", value: String(snapshot.total) },
              { label: "Not seen yet", value: String(snapshot.unseen) },
              { label: "Below target", value: String(snapshot.at_risk) },
              { label: "On target", value: String(snapshot.locked_in) },
            ]}
          />
        ) : (
          <Text style={styles.note}>The decks this exam covers have no cards to study.</Text>
        )}

        {active && hasCards ? (
          exam.ready_now > 0 ? (
            <Button
              variant="primary"
              size="xl"
              label={`Study now · ${readyLabel(exam.ready_now, exam.minutes_now)}`}
              disabled={busy}
              onPress={() => router.push(`/study/exam/${exam.id}`)}
              fullWidth
            />
          ) : (
            <View style={styles.doneBox} accessible>
              <Icon name="checkCircle" size={18} color={colors.accent} />
              <Text style={styles.doneText}>
                Done for now{nextSession ? ` · ${nextSession}` : ""}
              </Text>
            </View>
          )
        ) : null}

        {past ? (
          <Card padding={16} style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              How did it go?
            </Text>
            {exam.result_score != null && !editingScore ? (
              <View style={styles.scoreRow}>
                <Text style={[styles.cardBody, { flex: 1 }]}>
                  Your result: {Math.round(exam.result_score)}%
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  label="Change"
                  disabled={busy}
                  onPress={() => {
                    setScoreDraft(String(exam.result_score));
                    setEditingScore(true);
                  }}
                />
              </View>
            ) : (
              <>
                <Text style={styles.cardBody}>
                  Enter your result as a percentage, 0 to 100. It is kept with the exam.
                </Text>
                <View style={styles.scoreRow}>
                  <Field
                    accessibilityLabel="Your result, 0 to 100"
                    value={scoreDraft}
                    onChangeText={setScoreDraft}
                    placeholder="e.g. 78"
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    maxLength={5}
                    onSubmitEditing={() => void saveScore()}
                    containerStyle={{ flex: 1 }}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    label={busy ? "Saving…" : "Save"}
                    disabled={busy || scoreDraft.trim() === ""}
                    onPress={() => void saveScore()}
                  />
                </View>
              </>
            )}
          </Card>
        ) : null}

        {exam.status === "completed" && hasCards ? (
          <Card padding={16} style={{ gap: 12 }}>
            <Text accessibilityRole="header" style={styles.cardTitle}>
              What about these cards?
            </Text>
            <Text style={styles.cardBody}>
              Keep them and they carry on in your normal reviews. Let them go and they are
              suspended. Either way the exam moves to Archived.
            </Text>
            <Button
              variant="primary"
              size="lg"
              label="Keep studying these cards"
              disabled={busy}
              onPress={() => void runAction("archive")}
              fullWidth
            />
            <Button
              variant="secondary"
              size="lg"
              label="Let these cards go"
              disabled={busy}
              onPress={confirmLetGo}
              fullWidth
            />
          </Card>
        ) : null}

        {archived ? (
          <Button
            variant="secondary"
            size="lg"
            label="Unarchive"
            disabled={busy}
            onPress={() => void runAction("unarchive")}
            fullWidth
          />
        ) : null}

        {choices.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Daily time
            </Text>
            <Text style={styles.sectionHelper}>
              What each daily limit is expected to reach on the day. Pick one to change your plan.
            </Text>
            <View style={styles.group}>
              {choices.map((choice, index) => {
                const selected = choice.minutes === exam.daily_minutes_cap;
                const saving = savingCap === (choice.minutes ?? "none");
                return (
                  <Pressable
                    key={choice.minutes ?? "none"}
                    onPress={() => void chooseCap(choice.minutes)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: busy }}
                    accessibilityLabel={`${dailyCapLabel(choice.minutes)}, ${formatRecall(choice.recall)}`}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && styles.rowLine,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={styles.rowCheck}>
                      {saving ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : selected ? (
                        <Icon name="check" size={18} color={colors.accent} />
                      ) : null}
                    </View>
                    <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>
                      {dailyCapLabel(choice.minutes)}
                    </Text>
                    <Text
                      style={[
                        styles.rowValue,
                        choice.recall >= exam.target_recall - 0.005 && styles.rowValueStrong,
                      ]}
                    >
                      {formatRecall(choice.recall)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {active && plan.days.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Day by day
            </Text>
            <Text style={styles.sectionHelper}>
              What each day asks for, and where it leaves you for the exam.
            </Text>
            <View style={styles.group}>
              {planDays.map((day, index) => (
                <View key={day.date} style={[styles.row, index > 0 && styles.rowLine]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {formatPlanDay(day.date, index)}
                    </Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {day.reviews > 0
                        ? `${day.reviews} card${day.reviews === 1 ? "" : "s"}${
                            day.new_cards > 0 ? ` · ${day.new_cards} new` : ""
                          } · ${formatMinutes(Math.max(1, day.minutes))}`
                        : "Nothing planned"}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{formatRecall(day.recall_at_exam)}</Text>
                </View>
              ))}
            </View>
            {plan.days.length > PLAN_DAYS_SHOWN ? (
              <Button
                variant="secondary"
                size="sm"
                label={showAllDays ? "Show fewer days" : `Show all ${plan.days.length} days`}
                onPress={() => setShowAllDays((all) => !all)}
                style={{ alignSelf: "flex-start" }}
              />
            ) : null}
          </View>
        ) : null}

        {decks.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Where you stand
            </Text>
            <Text style={styles.sectionHelper}>
              {past
                ? "Predicted recall on the day for each deck, weakest first."
                : "Predicted recall on the day for each deck if you stopped now, weakest first."}
            </Text>
            <View style={styles.group}>
              {decks.map((deck, index) => (
                <DeckStanding
                  key={deck.project_id}
                  deck={deck}
                  target={exam.target_recall}
                  divider={index > 0}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <TextPromptModal
        visible={renameOpen}
        title="Rename exam"
        placeholder="Exam name"
        initialValue={exam.name}
        onSubmit={(value) => void runRename(value)}
        onClose={() => setRenameOpen(false)}
      />
    </View>
  );
}

/** One of the two headline numbers. */
function Headline({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.headlineItem} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.headlineValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <Text style={styles.headlineLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function DeckStanding({
  deck,
  target,
  divider,
}: {
  deck: ExamDeckBreakdownDto;
  target: number;
  divider: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const parts = [`${deck.total} card${deck.total === 1 ? "" : "s"}`];
  if (deck.unseen > 0) parts.push(`${deck.unseen} not seen`);
  if (deck.at_risk > 0) parts.push(`${deck.at_risk} below target`);
  if (deck.locked_in > 0) parts.push(`${deck.locked_in} on target`);
  return (
    <View style={[styles.deckRow, divider && styles.rowLine]}>
      <View style={styles.deckTop}>
        <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>
          {deck.name ? deckDisplayName(deck.name) : "Deck"}
        </Text>
        <Text style={[styles.rowValue, deck.recall_at_exam >= target - 0.005 && styles.rowValueStrong]}>
          {formatRecall(deck.recall_at_exam)}
        </Text>
      </View>
      <ProgressBar value={deck.recall_at_exam} height={4} />
      <Text style={styles.rowDetail} numberOfLines={1}>
        {parts.join(" · ")}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    errorText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 12,
    },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    dateText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    headline: {
      flexDirection: "row",
      gap: 16,
    },
    headlineItem: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    headlineValue: {
      fontSize: 34,
      lineHeight: 40,
      fontWeight: "600",
      letterSpacing: -0.5,
      color: colors.fgPrimary,
    },
    headlineLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    targetText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
    },
    warnBox: {
      flexDirection: "row",
      gap: 8,
      padding: 11,
      borderRadius: radius.xl,
      backgroundColor: colors.bgSunken,
    },
    warnText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgSecondary,
    },
    note: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
      paddingVertical: 4,
    },
    doneBox: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: radius.xl3,
      backgroundColor: colors.bgSunken,
    },
    doneText: {
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    cardTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    cardBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgSecondary,
    },
    scoreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    section: { gap: 8, marginTop: 12 },
    sectionTitle: {
      paddingHorizontal: 4,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    sectionHelper: {
      paddingHorizontal: 4,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
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
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    rowLine: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    rowPressed: { backgroundColor: colors.bgHover },
    rowCheck: { width: 20, alignItems: "center" },
    rowLabel: {
      fontSize: 16,
      lineHeight: 21,
      color: colors.fgPrimary,
    },
    rowDetail: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    rowValue: {
      fontSize: 15,
      lineHeight: 20,
      fontVariant: ["tabular-nums"],
      color: colors.fgSecondary,
    },
    rowValueStrong: {
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    deckRow: {
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    deckTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
  });
}
