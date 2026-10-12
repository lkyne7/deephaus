/**
 * Write DeepHaus scheduling state and review history into an exported Anki
 * collection: the inverse of `ankiCardToFsrs` and `ankiRevlogToFsrsLogs`.
 *
 * FSRS memory state goes into each card's `data` JSON (`s`, `d`), which Anki's
 * FSRS reads directly; the ease factor is approximated from difficulty for
 * SM-2 users. Anki does not store sub-day intervals on learning cards, so a
 * learning card's interval exports as 0.
 */
import type { Database } from "sql.js";

/** One review unit's current schedule (a `card_reviews` row). */
export interface ExportReviewState {
  /** 0 for basic cards, N for cloze deletion cN. */
  clozeOrd: number;
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  /** 0=new, 1=learning, 2=review, 3=relearning */
  state: number;
  suspended: boolean;
}

/** One past grade (a `review_logs` row). */
export interface ExportReviewLog {
  clozeOrd: number;
  /** 1=again … 4=easy */
  rating: number;
  /** State before the grade. */
  state: number;
  /** Interval before the grade, in days. */
  scheduledDays: number;
  review: string;
}

export interface ExportCardProgress {
  reviews: ExportReviewState[];
  logs: ExportReviewLog[];
}

export interface AppliedProgress {
  scheduled: number;
  suspended: number;
  reviewLogs: number;
}

const DAY_SECONDS = 86_400;

/** Anki revlog interval: positive days, or negative seconds below one day. */
function revlogInterval(days: number): number {
  if (days >= 1) return Math.round(days);
  if (days > 0) return -Math.max(1, Math.round(days * DAY_SECONDS));
  return 0;
}

/** Ease factor (×1000) approximated from FSRS difficulty; inverse of the import. */
function easeFactor(difficulty: number): number {
  if (!difficulty) return 2500;
  return Math.round(Math.min(5000, Math.max(1300, 2500 - ((difficulty - 5) / 2.5) * 1000)));
}

/** Anki revlog type from the state before the grade. */
function revlogType(state: number): number {
  if (state === 2) return 1;
  if (state === 3) return 2;
  return 0;
}

function seconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/**
 * Apply progress to a freshly built collection. `progress[i]` belongs to the
 * i-th note in insertion (id) order; undefined entries stay new cards.
 */
export function applyExportProgress(
  db: Database,
  progress: Array<ExportCardProgress | undefined>,
  now: Date = new Date(),
): AppliedProgress {
  const applied: AppliedProgress = { scheduled: 0, suspended: 0, reviewLogs: 0 };
  if (!progress.some((p) => p && (p.reviews.length > 0 || p.logs.length > 0))) return applied;

  const noteIds = (db.exec("select id from notes order by id")[0]?.values ?? []).map(([id]) => Number(id));
  const cardIdByNoteOrd = new Map<string, number>();
  for (const [id, nid, ord] of db.exec("select id, nid, ord from cards")[0]?.values ?? []) {
    cardIdByNoteOrd.set(`${nid}:${ord}`, Number(id));
  }
  const cardIdFor = (noteIndex: number, clozeOrd: number) =>
    cardIdByNoteOrd.get(`${noteIds[noteIndex]}:${Math.max(0, clozeOrd - 1)}`);

  // Review dues are days since collection creation, so start the collection
  // on a day boundary no later than the earliest review due date.
  const nowSeconds = Math.floor(now.getTime() / 1000);
  let crt = nowSeconds;
  for (const p of progress) {
    for (const r of p?.reviews ?? []) {
      if (r.state !== 0 && !Number.isNaN(Date.parse(r.due))) crt = Math.min(crt, seconds(r.due));
    }
  }
  crt = Math.floor(crt / DAY_SECONDS) * DAY_SECONDS;
  db.run("update col set crt = ?", [crt]);

  const updateCard = db.prepare(
    "update cards set type = ?, queue = ?, due = ?, ivl = ?, factor = ?, reps = ?, lapses = ?, left = ?, data = ?, mod = ? where id = ?",
  );
  const insertRevlog = db.prepare(
    "insert into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) values (?, ?, -1, ?, ?, ?, ?, 0, ?)",
  );
  const usedRevlogIds = new Set<number>();

  try {
    progress.forEach((p, noteIndex) => {
      if (!p) return;
      const scheduledDaysByOrd = new Map<number, number>();

      for (const r of p.reviews) {
        const cardId = cardIdFor(noteIndex, r.clozeOrd);
        if (cardId == null) continue;
        scheduledDaysByOrd.set(r.clozeOrd, r.scheduledDays);

        if (r.state === 0) {
          // New card that only carries a suspension: keep its new-card position.
          if (!r.suspended) continue;
          db.run("update cards set queue = -1, mod = ? where id = ?", [nowSeconds, cardId]);
        } else {
          const dueSeconds = seconds(r.due);
          const intraday = (r.state === 1 || r.state === 3) && r.scheduledDays < 1;
          const queue = r.suspended ? -1 : r.state === 2 ? 2 : intraday ? 1 : 3;
          const due = intraday ? dueSeconds : Math.round((dueSeconds - crt) / DAY_SECONDS);
          const ivl = r.state === 1 ? 0 : Math.max(1, Math.round(r.scheduledDays));
          const data = r.stability > 0 ? JSON.stringify({ s: r.stability, d: r.difficulty }) : "";
          updateCard.run([
            r.state, queue, due, ivl, easeFactor(r.difficulty), r.reps, r.lapses,
            r.state === 1 || r.state === 3 ? 1 : 0, data, nowSeconds, cardId,
          ]);
        }
        applied.scheduled += 1;
        if (r.suspended) applied.suspended += 1;
      }

      // Each grade's resulting interval is the next grade's prior interval,
      // or the unit's current interval for its latest grade.
      const logsByOrd = new Map<number, ExportReviewLog[]>();
      for (const log of p.logs) {
        const list = logsByOrd.get(log.clozeOrd);
        if (list) list.push(log);
        else logsByOrd.set(log.clozeOrd, [log]);
      }
      for (const [clozeOrd, logs] of logsByOrd) {
        const cardId = cardIdFor(noteIndex, clozeOrd);
        if (cardId == null) continue;
        logs.sort((a, b) => Date.parse(a.review) - Date.parse(b.review));
        logs.forEach((log, i) => {
          let id = Date.parse(log.review);
          if (Number.isNaN(id)) return;
          while (usedRevlogIds.has(id)) id += 1;
          usedRevlogIds.add(id);
          const after = i + 1 < logs.length ? logs[i + 1].scheduledDays : scheduledDaysByOrd.get(clozeOrd) ?? 0;
          insertRevlog.run([
            id, cardId, log.rating, revlogInterval(after), revlogInterval(log.scheduledDays),
            log.state >= 2 ? 2500 : 0, revlogType(log.state),
          ]);
          applied.reviewLogs += 1;
        });
      }
    });
  } finally {
    updateCard.free();
    insertRevlog.free();
  }

  return applied;
}
