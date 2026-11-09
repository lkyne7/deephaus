import type { SupabaseClient } from "@supabase/supabase-js";
import {
  examStatus,
  isEmptyExamSelection,
  normalizeExamSelection,
  normalizeStudyWindows,
  type ExamCardReason,
  type ExamDetailDto,
  type ExamInsightDto,
  type ExamListResponse,
  type ExamQueueCard,
  type ExamQueueResponse,
  type ExamRow,
  type ExamSelectionSpec,
  type ExamSummaryDto,
} from "@deephaus/shared";
import {
  buildExamInsight,
  buildExamSummary,
  buildScheduler,
  clozeOrdForQueue,
  estimatedSecondsPerReview,
  examQueue,
  examSpecOf,
  loadReviewHistories,
  loadUserWeights,
  newReviewFields,
  resolveWeights,
  reviewHistoryKey,
  toExamUnits,
  type DeckScheduler,
  type ExamContext,
  type ExamUnit,
  type ExamUnitRow,
  type FsrsWeights,
} from "@/lib/fsrs/scheduler";
import {
  resolveEffectiveDeckSettings,
  settingsFromRecord,
  type DeckStudySettings,
} from "@/lib/fsrs/settings";
import {
  loadGlobalStudySettings,
  type GlobalStudySettings,
} from "@/lib/fsrs/user-study-settings";
import { ExamServiceError } from "@/lib/exams/errors";
import type { CreateExamInput, PreviewExamInput, UpdateExamInput } from "@/lib/exams/schemas";
import { startOfStudyDayIso } from "@/lib/study/day-start";

export { ExamServiceError } from "@/lib/exams/errors";

const EXAM_SELECT =
  "id, user_id, name, exam_at, timezone, has_time, target_recall, daily_minutes_cap, selection_spec, study_windows, result_score, archived_at, created_at, updated_at";
const CARD_SELECT =
  "id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order";
/** How many recent answers set the student's pace. */
const PACE_SAMPLE = 101;
const ID_CHUNK = 200;

/** Everything about the student that every exam read needs. */
interface StudentContext {
  global: GlobalStudySettings;
  userWeights: FsrsWeights;
  secondsPerReview: number;
  now: Date;
}

interface DeckInfo {
  name: string;
  settings: DeckStudySettings;
  weights: FsrsWeights;
}

function normalizeExam(raw: unknown): ExamRow {
  const row = raw as ExamRow;
  return {
    ...row,
    target_recall: Number(row.target_recall),
    daily_minutes_cap: row.daily_minutes_cap == null ? null : Number(row.daily_minutes_cap),
    result_score: row.result_score == null ? null : Number(row.result_score),
    has_time: Boolean(row.has_time),
    selection_spec: normalizeExamSelection(row.selection_spec),
    study_windows: normalizeStudyWindows(row.study_windows),
  };
}

async function loadStudentContext(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<StudentContext> {
  const [global, userWeights, pace] = await Promise.all([
    loadGlobalStudySettings(supabase, userId),
    loadUserWeights(supabase, userId),
    supabase
      .from("review_logs")
      .select("response_ms")
      .eq("user_id", userId)
      .not("response_ms", "is", null)
      .order("review", { ascending: false })
      .limit(PACE_SAMPLE),
  ]);
  // The pace is a refinement; without it the default stands.
  const times = (pace.data ?? []).map((row) => Number(row.response_ms));
  return { global, userWeights, secondsPerReview: estimatedSecondsPerReview(times), now };
}

/** The study day follows the student's own setting, else the exam's timezone. */
function studyTimezone(student: StudentContext, examTimezone: string): string {
  return student.global.timezone ?? examTimezone;
}

async function loadUnitRows(
  supabase: SupabaseClient,
  userId: string,
  selection: ExamSelectionSpec,
  student: StudentContext,
  timezone: string,
): Promise<ExamUnitRow[]> {
  if (isEmptyExamSelection(selection)) return [];
  const { data, error } = await supabase.rpc("exam_units", {
    p_user_id: userId,
    p_selection: selection,
    p_day_start: startOfStudyDayIso(student.now, student.global.dayStartHour, timezone),
  });
  if (error) throw new ExamServiceError(error.message);
  return (Array.isArray(data) ? data : []) as ExamUnitRow[];
}

async function loadDecks(
  supabase: SupabaseClient,
  userId: string,
  projectIds: readonly string[],
  student: StudentContext,
): Promise<Map<string, DeckInfo>> {
  const decks = new Map<string, DeckInfo>();
  const ids = [...new Set(projectIds)];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, deck_name, settings")
      .eq("user_id", userId)
      .in("id", ids.slice(offset, offset + ID_CHUNK));
    if (error) throw new ExamServiceError(error.message);
    for (const project of data ?? []) {
      const settings = resolveEffectiveDeckSettings(
        settingsFromRecord(project.settings),
        student.global,
      );
      decks.set(project.id, {
        name: project.deck_name || project.name,
        settings,
        weights: resolveWeights(settings.fsrsParams, student.userWeights),
      });
    }
  }
  return decks;
}

function examContext(
  student: StudentContext,
  decks: ReadonlyMap<string, DeckInfo>,
  timezone: string,
): ExamContext {
  return {
    now: student.now,
    weightsByProject: new Map([...decks].map(([id, deck]) => [id, deck.weights])),
    defaultWeights: student.userWeights,
    timezone,
    dayStartHour: student.global.dayStartHour,
    easyDays: student.global.easyDays,
    secondsPerReview: student.secondsPerReview,
  };
}

interface LoadedExam {
  units: ExamUnit[];
  rows: ExamUnitRow[];
  decks: Map<string, DeckInfo>;
  context: ExamContext;
}

async function loadSelection(
  supabase: SupabaseClient,
  userId: string,
  selection: ExamSelectionSpec,
  examTimezone: string,
  student: StudentContext,
): Promise<LoadedExam> {
  const timezone = studyTimezone(student, examTimezone);
  const rows = await loadUnitRows(supabase, userId, selection, student, timezone);
  const decks = await loadDecks(
    supabase,
    userId,
    rows.map((row) => row.project_id),
    student,
  );
  return { rows, units: toExamUnits(rows), decks, context: examContext(student, decks, timezone) };
}

function deckNames(decks: ReadonlyMap<string, DeckInfo>): Map<string, string> {
  return new Map([...decks].map(([id, deck]) => [id, deck.name]));
}

async function loadOwnedExam(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
): Promise<ExamRow> {
  const { data, error } = await supabase
    .from("exams")
    .select(EXAM_SELECT)
    .eq("id", examId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ExamServiceError(error.message);
  if (!data) throw new ExamServiceError("Exam not found", 404);
  return normalizeExam(data);
}

async function detailOf(
  supabase: SupabaseClient,
  userId: string,
  exam: ExamRow,
  student: StudentContext,
): Promise<ExamDetailDto> {
  const loaded = await loadSelection(supabase, userId, exam.selection_spec, exam.timezone, student);
  return {
    exam: buildExamSummary(exam, loaded.units, loaded.context),
    ...buildExamInsight(loaded.units, examSpecOf(exam), loaded.context, deckNames(loaded.decks)),
  };
}

export async function listExams(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExamListResponse> {
  const [{ data, error }, student] = await Promise.all([
    supabase
      .from("exams")
      .select(EXAM_SELECT)
      .eq("user_id", userId)
      .order("exam_at", { ascending: true }),
    loadStudentContext(supabase, userId),
  ]);
  if (error) throw new ExamServiceError(error.message);
  const exams = await Promise.all(
    (data ?? []).map(async (raw): Promise<ExamSummaryDto> => {
      const exam = normalizeExam(raw);
      const loaded = await loadSelection(
        supabase,
        userId,
        exam.selection_spec,
        exam.timezone,
        student,
      );
      return buildExamSummary(exam, loaded.units, loaded.context);
    }),
  );
  return { exams };
}

export async function getExamDetail(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
): Promise<ExamDetailDto> {
  const [exam, student] = await Promise.all([
    loadOwnedExam(supabase, userId, examId),
    loadStudentContext(supabase, userId),
  ]);
  return detailOf(supabase, userId, exam, student);
}

/** What an exam would look like, without saving anything. */
export async function previewExam(
  supabase: SupabaseClient,
  userId: string,
  input: PreviewExamInput,
): Promise<ExamInsightDto> {
  const student = await loadStudentContext(supabase, userId);
  const loaded = await loadSelection(
    supabase,
    userId,
    input.selection_spec,
    input.timezone,
    student,
  );
  return buildExamInsight(loaded.units, examSpecOf(input), loaded.context, deckNames(loaded.decks));
}

function assertFuture(examAt: string, now: Date): void {
  if (!(Date.parse(examAt) > now.getTime())) {
    throw new ExamServiceError("Choose a date and time in the future", 400);
  }
}

export async function createExam(
  supabase: SupabaseClient,
  userId: string,
  input: CreateExamInput,
): Promise<ExamDetailDto> {
  const student = await loadStudentContext(supabase, userId);
  assertFuture(input.exam_at, student.now);
  if (isEmptyExamSelection(input.selection_spec)) {
    throw new ExamServiceError("Choose at least one deck, source or tag", 400);
  }
  const { data, error } = await supabase
    .from("exams")
    .insert({ user_id: userId, ...input })
    .select(EXAM_SELECT)
    .single();
  if (error) throw new ExamServiceError(error.message);
  return detailOf(supabase, userId, normalizeExam(data), student);
}

export async function updateExam(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
  patch: UpdateExamInput,
): Promise<ExamDetailDto> {
  const [exam, student] = await Promise.all([
    loadOwnedExam(supabase, userId, examId),
    loadStudentContext(supabase, userId),
  ]);
  // A finished exam keeps its date; only what describes it afterwards changes.
  // Compared as instants: the same moment can be written more than one way.
  if (patch.exam_at !== undefined && Date.parse(patch.exam_at) !== Date.parse(exam.exam_at)) {
    assertFuture(patch.exam_at, student.now);
  }
  if (patch.selection_spec && isEmptyExamSelection(patch.selection_spec)) {
    throw new ExamServiceError("Choose at least one deck, source or tag", 400);
  }
  const { data, error } = await supabase
    .from("exams")
    .update(patch)
    .eq("id", examId)
    .eq("user_id", userId)
    .select(EXAM_SELECT)
    .single();
  if (error) throw new ExamServiceError(error.message);
  return detailOf(supabase, userId, normalizeExam(data), student);
}

/** Take every card the exam covers out of future study. */
async function suspendExamCards(
  supabase: SupabaseClient,
  userId: string,
  rows: readonly ExamUnitRow[],
  now: Date,
): Promise<void> {
  const seen = new Set(rows.filter((row) => row.review).map((row) => row.card_id));
  const all = [...new Set(rows.map((row) => row.card_id))];
  const stamp = now.toISOString();
  for (let offset = 0; offset < all.length; offset += ID_CHUNK) {
    const chunk = all.slice(offset, offset + ID_CHUNK);
    const withRows = chunk.filter((id) => seen.has(id));
    if (withRows.length > 0) {
      const { error } = await supabase
        .from("card_reviews")
        .update({ suspended: true, updated_at: stamp })
        .eq("user_id", userId)
        .in("card_id", withRows);
      if (error) throw new ExamServiceError(error.message);
    }
    // A card never reviewed has no row to flag, so it gets a new-state one,
    // exactly as suspending a single card does.
    const fresh = chunk.filter((id) => !seen.has(id));
    if (fresh.length > 0) {
      const fields = newReviewFields(now);
      const { error } = await supabase.from("card_reviews").upsert(
        fresh.map((card_id) => ({
          card_id,
          user_id: userId,
          cloze_ord: 0,
          ...fields,
          suspended: true,
          updated_at: stamp,
        })),
        { onConflict: "card_id,user_id,cloze_ord" },
      );
      if (error) throw new ExamServiceError(error.message);
    }
  }
}

export async function runExamAction(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
  action: "archive" | "unarchive" | "suspend_cards",
): Promise<ExamDetailDto> {
  const [exam, student] = await Promise.all([
    loadOwnedExam(supabase, userId, examId),
    loadStudentContext(supabase, userId),
  ]);
  let archivedAt = exam.archived_at;
  if (action === "suspend_cards") {
    const timezone = studyTimezone(student, exam.timezone);
    const rows = await loadUnitRows(supabase, userId, exam.selection_spec, student, timezone);
    await suspendExamCards(supabase, userId, rows, student.now);
    // Letting the cards go ends the exam's part in the app.
    archivedAt = archivedAt ?? student.now.toISOString();
  } else {
    archivedAt = action === "archive" ? student.now.toISOString() : null;
  }
  const { data, error } = await supabase
    .from("exams")
    .update({ archived_at: archivedAt })
    .eq("id", examId)
    .eq("user_id", userId)
    .select(EXAM_SELECT)
    .single();
  if (error) throw new ExamServiceError(error.message);
  return detailOf(supabase, userId, normalizeExam(data), student);
}

export async function deleteExam(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
): Promise<void> {
  await loadOwnedExam(supabase, userId, examId);
  const { error } = await supabase.from("exams").delete().eq("id", examId).eq("user_id", userId);
  if (error) throw new ExamServiceError(error.message);
}

type CardBody = {
  id: string;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
  tags: string[] | null;
};

async function loadCardBodies(
  supabase: SupabaseClient,
  cardIds: readonly string[],
): Promise<Map<string, CardBody>> {
  const bodies = new Map<string, CardBody>();
  const ids = [...new Set(cardIds)];
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK) {
    // RLS limits this to the caller's own cards.
    const { data, error } = await supabase
      .from("cards")
      .select(CARD_SELECT)
      .in("id", ids.slice(offset, offset + ID_CHUNK));
    if (error) throw new ExamServiceError(error.message);
    for (const card of (data ?? []) as CardBody[]) bodies.set(card.id, card);
  }
  return bodies;
}

/**
 * The next cards of an exam session, in the shape Study Mode reads. Answers go
 * to the ordinary card review route with context "exam".
 */
export async function getExamQueue(
  supabase: SupabaseClient,
  userId: string,
  examId: string,
  options: { limit: number },
): Promise<ExamQueueResponse> {
  const [exam, student] = await Promise.all([
    loadOwnedExam(supabase, userId, examId),
    loadStudentContext(supabase, userId),
  ]);
  const loaded = await loadSelection(supabase, userId, exam.selection_spec, exam.timezone, student);
  const summary = buildExamSummary(exam, loaded.units, loaded.context);
  const active = examStatus(exam, student.now) === "active";
  const queue = active
    ? examQueue(loaded.units, examSpecOf(exam), loaded.context)
    : { items: [], skipped: 0, nextReadyAt: null, newAllowance: 0, learnAhead: false };
  const page = queue.items.slice(0, options.limit);

  const rowByKey = new Map(loaded.units.map((unit, index) => [unit.key, loaded.rows[index]!]));
  const [bodies, histories] = await Promise.all([
    loadCardBodies(
      supabase,
      page.map((item) => item.cardId),
    ),
    loadReviewHistories(
      supabase,
      userId,
      page.filter((item) => item.reason !== "new").map((item) => item.cardId),
    ),
  ]);

  // Previews use each deck's own retention, as grading will.
  const schedulers = new Map<string, DeckScheduler>();
  const schedulerFor = (projectId: string) => {
    let scheduler = schedulers.get(projectId);
    if (!scheduler) {
      const deck = loaded.decks.get(projectId);
      scheduler = buildScheduler({
        weights: deck?.weights ?? student.userWeights,
        requestRetention: deck?.settings.desiredRetention ?? student.global.desiredRetention,
        easyDays: student.global.easyDays,
        timezone: student.global.timezone,
        dayStartHour: student.global.dayStartHour,
      });
      schedulers.set(projectId, scheduler);
    }
    return scheduler;
  };

  const cards: ExamQueueCard[] = [];
  for (const item of page) {
    const row = rowByKey.get(item.key);
    const body = bodies.get(item.cardId);
    if (!row || !body) continue;
    const review = row.review;
    cards.push({
      id: body.id,
      queue_key: item.key,
      cloze_ord: clozeOrdForQueue(body, row.cloze_ord),
      type: body.type as ExamQueueCard["type"],
      front: body.front,
      back: body.back,
      cloze_text: body.cloze_text,
      extra: body.extra,
      occlusion_data: body.occlusion_data ?? null,
      tags: body.tags ?? [],
      state: review?.state ?? 0,
      due: review?.due ?? student.now.toISOString(),
      reps: review?.reps ?? 0,
      lapses: review?.lapses ?? 0,
      is_new: !review || review.state === 0,
      intervals: schedulerFor(item.projectId).previewIntervals({
        cardKey: reviewHistoryKey(item.cardId, row.cloze_ord),
        review,
        history: histories.get(reviewHistoryKey(item.cardId, row.cloze_ord)) ?? [],
        now: student.now,
      }),
      deck_id: item.projectId,
      deck_name: loaded.decks.get(item.projectId)?.name ?? exam.name,
      reason: item.reason as ExamCardReason,
    });
  }

  const count = (match: (reason: string) => boolean) =>
    queue.items.filter((item) => match(item.reason)).length;
  return {
    deck: { id: exam.id, name: exam.name },
    cards,
    counts: {
      due: count((reason) => reason !== "new"),
      new: count((reason) => reason === "new"),
      learning: count((reason) => reason === "learning" || reason === "first-learning"),
      total: cards.length,
    },
    day_start_hour: student.global.dayStartHour,
    learn_ahead: queue.learnAhead,
    exam: summary,
    skipped: queue.skipped,
    next_ready_at: queue.nextReadyAt ? queue.nextReadyAt.toISOString() : null,
  };
}
