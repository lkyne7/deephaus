import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  examStatus,
  isEmptyExamSelection,
  normalizeExamSelection,
  normalizeStudyWindows,
  type ExamCardReason,
  type ExamDetailDto,
  type ExamListResponse,
  type ExamQueueCard,
  type ExamQueueResponse,
  type ExamRow,
  type ExamSelectionSpec,
} from "@deephaus/shared";
import {
  buildExamInsight,
  buildExamSummary,
  buildScheduler,
  estimatedSecondsPerReview,
  examQueue,
  examSpecOf,
  expandCardToQueueItems,
  resolveWeights,
  startOfStudyDayIso,
  toExamUnits,
  type DeckScheduler,
  type ExamContext,
  type ExamUnit,
  type ExamUnitRow,
  type FsrsWeights,
  type StudyCardRow,
  type StudyReviewRow,
} from "@deephaus/scheduling";
import {
  getLocalStudySettings,
  getLocalUserFsrsWeights,
  type LocalStudySettings,
} from "./dashboard";
import { getLocalReviewHistories, reviewHistoryKey } from "./history";
import { resolveLocalDeckSettings, type LocalDeckStudySettings } from "./session";

/**
 * Exams from the local replica. These mirror apps/web/src/lib/exams/service.ts
 * and build the same payloads with the same planner, so an exam reads the same
 * online and offline. Exams themselves are read-only here; study for one is an
 * ordinary local review with context "exam".
 */

const DECK_JOIN =
  "JOIN generation_jobs gj ON gj.id = c.job_id JOIN sources s ON s.id = gj.source_id";
const PACE_SAMPLE = 101;
/** Above this, the time-versus-score curve is left to the server. */
const LOCAL_CURVE_MAX_UNITS = 500;

type Db = AbstractPowerSyncDatabase;
type Row = Record<string, unknown>;

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseTags(raw: unknown): string[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
}

function toExamRow(row: Row): ExamRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id ?? ""),
    name: String(row.name ?? ""),
    exam_at: String(row.exam_at),
    timezone: String(row.timezone ?? "UTC"),
    has_time: Number(row.has_time ?? 0) !== 0,
    target_recall: Number(row.target_recall ?? 0.9),
    daily_minutes_cap: row.daily_minutes_cap == null ? null : Number(row.daily_minutes_cap),
    selection_spec: normalizeExamSelection(row.selection_spec),
    study_windows: normalizeStudyWindows(row.study_windows),
    result_score: row.result_score == null ? null : Number(row.result_score),
    archived_at: (row.archived_at as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

interface StudentContext {
  global: LocalStudySettings;
  userWeights: FsrsWeights;
  secondsPerReview: number;
  now: Date;
}

async function loadStudentContext(db: Db): Promise<StudentContext> {
  const [global, userWeights, pace] = await Promise.all([
    getLocalStudySettings(db),
    getLocalUserFsrsWeights(db),
    db.getAll<{ response_ms: number }>(
      `SELECT response_ms FROM review_logs
       WHERE response_ms IS NOT NULL
       ORDER BY review DESC LIMIT ${PACE_SAMPLE}`,
    ),
  ]);
  return {
    global,
    userWeights,
    secondsPerReview: estimatedSecondsPerReview(pace.map((row) => Number(row.response_ms))),
    now: new Date(),
  };
}

/**
 * The WHERE clause for a selection over `cards c` joined to its source `s`.
 * Scoped filters narrow each other; card ids are added on top, as on the server.
 */
function selectionFilter(spec: ExamSelectionSpec): { where: string; params: string[] } {
  const params: string[] = [];
  const marks = (values: string[]) => {
    params.push(...values);
    return values.map(() => "?").join(", ");
  };
  const scoped: string[] = [];
  if (spec.deck_ids.length > 0) scoped.push(`s.project_id IN (${marks(spec.deck_ids)})`);
  if (spec.source_ids.length > 0) scoped.push(`s.id IN (${marks(spec.source_ids)})`);
  if (spec.chunk_ids.length > 0) scoped.push(`c.source_chunk_id IN (${marks(spec.chunk_ids)})`);
  if (spec.tags.length > 0) {
    scoped.push(
      `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(c.tags) THEN c.tags ELSE '[]' END) t
               WHERE t.value IN (${marks(spec.tags)}))`,
    );
  }
  const parts: string[] = [];
  if (scoped.length > 0) parts.push(`(${scoped.join(" AND ")})`);
  if (spec.card_ids.length > 0) parts.push(`c.id IN (${marks(spec.card_ids)})`);
  return { where: parts.join(" OR "), params };
}

function toReviewRow(row: Row): StudyReviewRow {
  return {
    card_id: String(row.card_id),
    cloze_ord: Number(row.cloze_ord ?? 0),
    due: String(row.due),
    stability: Number(row.stability ?? 0),
    difficulty: Number(row.difficulty ?? 0),
    elapsed_days: Number(row.elapsed_days ?? 0),
    scheduled_days: Number(row.scheduled_days ?? 0),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    state: Number(row.state ?? 0),
    last_review: (row.last_review as string | null) ?? null,
    learning_steps: Number(row.learning_steps ?? 0),
    suspended: Number(row.suspended ?? 0) !== 0,
    stability_fast: row.stability_fast == null ? null : Number(row.stability_fast),
    fsrs_version: row.fsrs_version == null ? null : Number(row.fsrs_version),
  };
}

/** Local replica of the `exam_units` database function. */
async function loadUnitRows(
  db: Db,
  selection: ExamSelectionSpec,
  student: StudentContext,
  timezone: string,
): Promise<ExamUnitRow[]> {
  if (isEmptyExamSelection(selection)) return [];
  const filter = selectionFilter(selection);
  const dayStart = startOfStudyDayIso(student.now, student.global.day_start_hour, timezone);
  const [cards, reviews, logs] = await Promise.all([
    db.getAll<Row>(
      `SELECT c.id, c.type, c.cloze_text, c.occlusion_data, c.sort_order, s.project_id
       FROM cards c ${DECK_JOIN}
       WHERE ${filter.where}
       ORDER BY s.project_id, c.sort_order, c.id`,
      filter.params,
    ),
    db.getAll<Row>(
      `SELECT cr.card_id, cr.cloze_ord, cr.due, cr.stability, cr.difficulty, cr.elapsed_days,
              cr.scheduled_days, cr.reps, cr.lapses, cr.state, cr.last_review, cr.learning_steps,
              cr.suspended, cr.stability_fast, cr.fsrs_version
       FROM card_reviews cr
       WHERE cr.card_id IN (SELECT c.id FROM cards c ${DECK_JOIN} WHERE ${filter.where})`,
      filter.params,
    ),
    db.getAll<{ card_id: string; cloze_ord: number | null; rating: number }>(
      `SELECT card_id, cloze_ord, rating FROM review_logs
       WHERE review >= ? AND COALESCE(undone, 0) = 0
       ORDER BY review`,
      [dayStart],
    ),
  ]);

  const reviewsByCard = new Map<string, StudyReviewRow[]>();
  for (const raw of reviews) {
    const review = toReviewRow(raw);
    const list = reviewsByCard.get(review.card_id);
    if (list) list.push(review);
    else reviewsByCard.set(review.card_id, [review]);
  }
  const today = new Map<string, number[]>();
  for (const log of logs) {
    const key = `${log.card_id}:${Number(log.cloze_ord ?? 0)}`;
    const list = today.get(key);
    if (list) list.push(Number(log.rating));
    else today.set(key, [Number(log.rating)]);
  }

  const units: ExamUnitRow[] = [];
  for (const raw of cards) {
    const cardReviews = reviewsByCard.get(String(raw.id)) ?? [];
    // One suspended ordinal keeps the whole card out, as in Study Mode.
    if (cardReviews.some((review) => review.suspended)) continue;
    const card: StudyCardRow = {
      id: String(raw.id),
      type: String(raw.type),
      front: null,
      back: null,
      cloze_text: (raw.cloze_text as string | null) ?? null,
      extra: null,
      occlusion_data: parseJson(raw.occlusion_data),
      tags: [],
      sort_order: Number(raw.sort_order ?? 0),
    };
    for (const item of expandCardToQueueItems(card, cardReviews)) {
      const ord = item.cloze_ord ?? 0;
      units.push({
        card_id: card.id,
        cloze_ord: ord,
        project_id: String(raw.project_id),
        review: item.review,
        today: today.get(`${card.id}:${ord}`) ?? [],
      });
    }
  }
  return units;
}

interface DeckInfo {
  name: string;
  settings: LocalDeckStudySettings;
  weights: FsrsWeights;
}

async function loadDecks(db: Db, student: StudentContext): Promise<Map<string, DeckInfo>> {
  const rows = await db.getAll<{
    id: string;
    name: string;
    deck_name: string | null;
    settings: string | null;
  }>(`SELECT id, name, deck_name, settings FROM projects`);
  return new Map(
    rows.map((project) => {
      const settings = resolveLocalDeckSettings(project.settings, student.global);
      return [
        project.id,
        {
          name: project.deck_name || project.name,
          settings,
          weights: resolveWeights(settings.fsrsParams, student.userWeights),
        },
      ];
    }),
  );
}

interface LoadedExam {
  rows: ExamUnitRow[];
  units: ExamUnit[];
  decks: Map<string, DeckInfo>;
  context: ExamContext;
}

async function loadSelection(
  db: Db,
  selection: ExamSelectionSpec,
  examTimezone: string,
  student: StudentContext,
  decks: Map<string, DeckInfo>,
): Promise<LoadedExam> {
  const timezone = student.global.timezone ?? examTimezone;
  const rows = await loadUnitRows(db, selection, student, timezone);
  return {
    rows,
    units: toExamUnits(rows),
    decks,
    context: {
      now: student.now,
      weightsByProject: new Map([...decks].map(([id, deck]) => [id, deck.weights])),
      defaultWeights: student.userWeights,
      timezone,
      dayStartHour: student.global.day_start_hour,
      easyDays: student.global.easy_days,
      secondsPerReview: student.secondsPerReview,
    },
  };
}

async function loadExam(db: Db, examId: string): Promise<ExamRow | null> {
  const row = await db.getOptional<Row>(`SELECT * FROM exams WHERE id = ?`, [examId]);
  return row ? toExamRow(row) : null;
}

/** Local replica of GET /api/exams. */
export async function getLocalExamList(db: Db): Promise<ExamListResponse> {
  const [rows, student] = await Promise.all([
    db.getAll<Row>(`SELECT * FROM exams ORDER BY exam_at ASC`),
    loadStudentContext(db),
  ]);
  const decks = await loadDecks(db, student);
  const exams = [];
  for (const raw of rows) {
    const exam = toExamRow(raw);
    const loaded = await loadSelection(db, exam.selection_spec, exam.timezone, student, decks);
    exams.push(buildExamSummary(exam, loaded.units, loaded.context));
  }
  return { exams };
}

/** Local replica of GET /api/exams/{id}. */
export async function getLocalExamDetail(db: Db, examId: string): Promise<ExamDetailDto | null> {
  const exam = await loadExam(db, examId);
  if (!exam) return null;
  const student = await loadStudentContext(db);
  const decks = await loadDecks(db, student);
  const loaded = await loadSelection(db, exam.selection_spec, exam.timezone, student, decks);
  const names = new Map([...decks].map(([id, deck]) => [id, deck.name]));
  return {
    exam: buildExamSummary(exam, loaded.units, loaded.context),
    ...buildExamInsight(loaded.units, examSpecOf(exam), loaded.context, names, {
      curve: loaded.units.length <= LOCAL_CURVE_MAX_UNITS,
    }),
  };
}

/** Local replica of GET /api/exams/{id}/queue. */
export async function getLocalExamQueue(
  db: Db,
  examId: string,
  options: { limit?: number } = {},
): Promise<ExamQueueResponse | null> {
  const exam = await loadExam(db, examId);
  if (!exam) return null;
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const student = await loadStudentContext(db);
  const decks = await loadDecks(db, student);
  const loaded = await loadSelection(db, exam.selection_spec, exam.timezone, student, decks);
  const summary = buildExamSummary(exam, loaded.units, loaded.context);
  const active = examStatus(exam, student.now) === "active";
  const queue = active
    ? examQueue(loaded.units, examSpecOf(exam), loaded.context)
    : { items: [], skipped: 0, nextReadyAt: null, newAllowance: 0, learnAhead: false };
  const page = queue.items.slice(0, limit);

  const rowByKey = new Map(loaded.units.map((unit, index) => [unit.key, loaded.rows[index]!]));
  const cardIds = [...new Set(page.map((item) => item.cardId))];
  const [bodies, histories] = await Promise.all([
    cardIds.length === 0
      ? Promise.resolve([] as Row[])
      : db.getAll<Row>(
          `SELECT id, type, front, back, cloze_text, extra, occlusion_data, tags
           FROM cards WHERE id IN (${cardIds.map(() => "?").join(", ")})`,
          cardIds,
        ),
    getLocalReviewHistories(
      db,
      page.filter((item) => item.reason !== "new").map((item) => item.cardId),
    ),
  ]);
  const bodyById = new Map(bodies.map((body) => [String(body.id), body]));

  // Previews use each deck's own retention, as grading will.
  const schedulers = new Map<string, DeckScheduler>();
  const schedulerFor = (projectId: string) => {
    let scheduler = schedulers.get(projectId);
    if (!scheduler) {
      const deck = decks.get(projectId);
      scheduler = buildScheduler({
        weights: deck?.weights ?? student.userWeights,
        requestRetention: deck?.settings.desiredRetention ?? student.global.desired_retention,
        easyDays: student.global.easy_days,
        timezone: student.global.timezone,
        dayStartHour: student.global.day_start_hour,
      });
      schedulers.set(projectId, scheduler);
    }
    return scheduler;
  };

  const cards: ExamQueueCard[] = [];
  for (const item of page) {
    const row = rowByKey.get(item.key);
    const body = bodyById.get(item.cardId);
    if (!row || !body) continue;
    const review = row.review;
    const type = String(body.type) as ExamQueueCard["type"];
    const historyKey = reviewHistoryKey(item.cardId, row.cloze_ord);
    cards.push({
      id: item.cardId,
      queue_key: item.key,
      cloze_ord:
        row.cloze_ord > 0 && (type === "cloze" || type === "image-occlusion")
          ? row.cloze_ord
          : null,
      type,
      front: (body.front as string | null) ?? null,
      back: (body.back as string | null) ?? null,
      cloze_text: (body.cloze_text as string | null) ?? null,
      extra: (body.extra as string | null) ?? null,
      occlusion_data: parseJson(body.occlusion_data),
      tags: parseTags(body.tags),
      state: review?.state ?? 0,
      due: review?.due ?? student.now.toISOString(),
      reps: review?.reps ?? 0,
      lapses: review?.lapses ?? 0,
      is_new: !review || review.state === 0,
      intervals: schedulerFor(item.projectId).previewIntervals({
        cardKey: historyKey,
        review,
        history: histories.get(historyKey) ?? [],
        now: student.now,
      }),
      deck_id: item.projectId,
      deck_name: decks.get(item.projectId)?.name ?? exam.name,
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
    day_start_hour: student.global.day_start_hour,
    learn_ahead: queue.learnAhead,
    exam: summary,
    skipped: queue.skipped,
    next_ready_at: queue.nextReadyAt ? queue.nextReadyAt.toISOString() : null,
  };
}
