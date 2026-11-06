"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudyMediaPreload } from "@/lib/study/use-study-media-preload";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import { STUDY_GRADES, type StudyGradeId } from "@/components/study-review-chrome";
import {
  formatSessionLength,
  StudyCardFace,
  StudyComplete,
  StudyDock,
  StudyError,
  StudyFrame,
  StudyHeader,
  StudyMessage,
  StudyMeta,
  StudyMoreMenu,
  StudySkeleton,
} from "@/components/study/study-chrome";
import {
  useStudyPanel,
  useStudyPreferences,
  useStudyShortcuts,
} from "@/components/study/use-study-session-controls";
import { apiFetch } from "@/lib/api/fetch";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import {
  getErrorMessage,
  isRecord,
  normalizeQueueItem,
  readinessPercent,
  type CramCard,
  type CramPlan,
  type CramQueueResponse,
} from "./types";

type SessionStats = Record<StudyGradeId, number>;

const EMPTY_STATS: SessionStats = { again: 0, hard: 0, good: 0, easy: 0 };

type QueueCounts = {
  due: number;
  new: number;
  remaining: number;
  total: number;
};

const EMPTY_COUNTS: QueueCounts = { due: 0, new: 0, remaining: 0, total: 0 };

type QueueMeta = {
  dailyBudget: number | null;
  reviewedToday: number;
  remainingToday: number | null;
  budgetReached: boolean;
  readiness: number | null;
};

const EMPTY_META: QueueMeta = {
  dailyBudget: null,
  reviewedToday: 0,
  remainingToday: null,
  budgetReached: false,
  readiness: null,
};

/** A cram API error that carries the HTTP status so 409s (plan not active) can be told apart from failures. */
class CramRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function planNotActive(error: unknown): error is CramRequestError {
  return error instanceof CramRequestError && error.status === 409;
}

export function CramStudyMode({ planId }: { planId: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<CramPlan | null>(null);
  const [queue, setQueue] = useState<CramCard[]>([]);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Checking the server for more queued cards after finishing the local batch. */
  const [refilling, setRefilling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  /** Set when the plan can no longer be studied (completed, paused, past its deadline). */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [meta, setMeta] = useState<QueueMeta>(EMPTY_META);
  /** Sticky for the session once the user chooses to study past the budget. */
  const [continueBeyondBudget, setContinueBeyondBudget] = useState(false);
  const { textScaleIndex, setTextScale, audioAutoplay, setAudioAutoplay } = useStudyPreferences();
  const shownAtRef = useRef(Date.now());
  const startedAt = useRef(Date.now());

  const fetchQueue = useCallback(
    async (continuePastBudget: boolean) => {
      const params = new URLSearchParams({ limit: "200" });
      if (continuePastBudget) params.set("continue", "1");
      const response = await apiFetch(`/api/cram-plans/${planId}/queue?${params}`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new CramRequestError(
          getErrorMessage(payload, "Could not load the cram queue."),
          response.status,
        );
      }
      const root = isRecord(payload) ? (payload as CramQueueResponse) : {};
      const rawQueue = root.queue ?? root.items ?? root.cards ?? [];
      const cards = Array.isArray(rawQueue)
        ? rawQueue.map(normalizeQueueItem).filter((card): card is CramCard => card !== null)
        : [];
      return { root, cards };
    },
    [planId],
  );

  const loadQueue = useCallback(
    async (continuePastBudget = false) => {
      setLoading(true);
      setError(null);
      setUnavailable(null);
      try {
        const { root, cards } = await fetchQueue(continuePastBudget);
        setPlan(isRecord(root.plan) ? (root.plan as CramPlan) : null);
        setQueue(cards);
        setCounts(queueCounts(root));
        setIdx(0);
        setRevealed(false);
        setDone(cards.length === 0);
        if (continuePastBudget) setContinueBeyondBudget(true);
        setMeta(queueMeta(root));
        shownAtRef.current = Date.now();
        startedAt.current = Date.now();
      } catch (caught) {
        if (planNotActive(caught)) setUnavailable(caught.message);
        else setError(caught instanceof Error ? caught.message : "Could not load the cram queue.");
      } finally {
        setLoading(false);
      }
    },
    [fetchQueue],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const card = queue[idx];
  // Decode the next cards' images before they are shown so they never pop in.
  useStudyMediaPreload(queue, idx);
  const budgetPrompt = meta.budgetReached && !continueBeyondBudget && !done && !!card;

  const grade = useCallback(
    async (gradeId: StudyGradeId) => {
      if (!card || !revealed || budgetPrompt) return;
      const gradedIndex = idx;
      const gradedCard = card;
      const rating = STUDY_GRADES.find((entry) => entry.id === gradeId)!.rating;
      const advancingToEnd = gradedIndex + 1 >= queue.length;
      const responseMs = Math.max(0, Date.now() - shownAtRef.current);

      // Advance optimistically — the review is saved in the background so the
      // next card appears instantly, matching the default study reviewer.
      setError(null);
      setRevealed(false);
      setStats((prev) => ({ ...prev, [gradeId]: prev[gradeId] + 1 }));
      setCounts((prev) => ({
        ...prev,
        due: gradedCard.is_new ? prev.due : Math.max(0, prev.due - 1),
        new: gradedCard.is_new ? Math.max(0, prev.new - 1) : prev.new,
        remaining: Math.max(0, prev.remaining - 1),
      }));
      setMeta((previous) => ({
        ...previous,
        reviewedToday: previous.reviewedToday + 1,
        remainingToday:
          previous.remainingToday === null ? null : Math.max(0, previous.remainingToday - 1),
      }));
      if (advancingToEnd) {
        // The plan may have more work queued: learning cards graded "Again"
        // earlier in the session come due again within minutes. Check the
        // server before showing the completion screen.
        setRefilling(true);
      } else {
        setIdx(gradedIndex + 1);
        shownAtRef.current = Date.now();
      }

      try {
        const response = await apiFetch(`/api/cram-plans/${planId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: gradedCard.item_id,
            rating,
            response_ms: responseMs,
          }),
          keepalive: true,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new CramRequestError(
            getErrorMessage(payload, "Could not save this review."),
            response.status,
          );
        }
        if (isRecord(payload)) {
          // Reviews can be pipelined, so a slower response for an earlier card
          // may land after later optimistic updates; never move counts backwards.
          setMeta((previous) => {
            const merged = mergeQueueMeta(previous, payload);
            return {
              ...merged,
              reviewedToday: Math.max(merged.reviewedToday, previous.reviewedToday),
              remainingToday:
                merged.remainingToday === null || previous.remainingToday === null
                  ? merged.remainingToday ?? previous.remainingToday
                  : Math.min(merged.remainingToday, previous.remainingToday),
            };
          });
        }
        if (advancingToEnd) {
          // Refill is only checked once the final review has been recorded so
          // the rebuilt queue reflects it.
          try {
            const { root, cards } = await fetchQueue(continueBeyondBudget);
            setCounts(queueCounts(root));
            setMeta(queueMeta(root));
            if (cards.length > 0) {
              setQueue(cards);
              setIdx(0);
              setRevealed(false);
              shownAtRef.current = Date.now();
            } else {
              setDone(true);
            }
          } catch {
            // Refill is best-effort; the review itself succeeded.
            setDone(true);
          } finally {
            setRefilling(false);
          }
        }
      } catch (caught) {
        // Roll back the optimistic advance and let the user retry the card.
        setStats((prev) => ({ ...prev, [gradeId]: Math.max(0, prev[gradeId] - 1) }));
        setCounts((prev) => ({
          ...prev,
          due: gradedCard.is_new ? prev.due : prev.due + 1,
          new: gradedCard.is_new ? prev.new + 1 : prev.new,
          remaining: prev.remaining + 1,
        }));
        setMeta((previous) => ({
          ...previous,
          reviewedToday: Math.max(0, previous.reviewedToday - 1),
          remainingToday:
            previous.remainingToday === null ? null : previous.remainingToday + 1,
        }));
        setRefilling(false);
        setDone(false);
        setIdx(gradedIndex);
        setRevealed(true);
        // The deadline passing (or the plan being paused elsewhere) ends the
        // session rather than leaving a card that can never be graded.
        if (planNotActive(caught) && /deadline|completed|paused|archived/i.test(caught.message)) {
          setUnavailable(caught.message);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Could not save this review.");
      }
    },
    [budgetPrompt, card, continueBeyondBudget, fetchQueue, idx, planId, queue.length, revealed],
  );

  const suspendCurrentCard = useCallback(async () => {
    if (!card || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cards/${card.id}/suspend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: true }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to suspend card"));
      const suspendedIndex = idx;
      setRevealed(false);
      // A suspended card leaves the plan's queue, so the footer counts drop
      // the same way they do after a grade.
      setCounts((prev) => ({
        ...prev,
        due: card.is_new ? prev.due : Math.max(0, prev.due - 1),
        new: card.is_new ? Math.max(0, prev.new - 1) : prev.new,
        remaining: Math.max(0, prev.remaining - 1),
        total: Math.max(0, prev.total - 1),
      }));
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== suspendedIndex);
        if (next.length === 0) {
          setDone(true);
          setIdx(0);
        } else if (suspendedIndex >= next.length) {
          setIdx(next.length - 1);
        }
        return next;
      });
      shownAtRef.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to suspend card");
    } finally {
      setSubmitting(false);
    }
  }, [card, idx, submitting]);

  const continuePastBudget = useCallback(() => {
    setContinueBeyondBudget(true);
    void loadQueue(true);
  }, [loadQueue]);

  const sessionCompleted = stats.again + stats.hard + stats.good + stats.easy;
  const budgetChoice = meta.budgetReached && !continueBeyondBudget && (done || !card);

  if (loading || refilling) return <StudySkeleton />;

  if (unavailable) {
    return (
      <StudyMessage icon="ri-flag-2-line" title="This plan isn't open for study" body={unavailable}>
        <button className="btn btn-secondary" onClick={() => router.push("/cram")}>
          All cram plans
        </button>
        <button className="btn btn-primary" onClick={() => router.push(`/cram/${planId}`)}>
          Back to plan
        </button>
      </StudyMessage>
    );
  }

  if (error && queue.length === 0 && !done) {
    return (
      <StudyMessage icon="ri-error-warning-line" body={error}>
        <button className="btn btn-primary" onClick={() => void loadQueue()}>
          Retry
        </button>
      </StudyMessage>
    );
  }

  if (budgetChoice) {
    return (
      <StudyMessage
        icon="ri-time-line"
        title="Daily budget reached"
        body={
          <>
            You&apos;ve met today&apos;s planned effort
            {meta.dailyBudget !== null ? ` (${meta.reviewedToday} / ${meta.dailyBudget} reviews)` : ""}.
            Continuing is optional and won&apos;t affect your regular reviews.
          </>
        }
      >
        <button className="btn btn-secondary" onClick={() => router.push(`/cram/${planId}`)}>
          Finish for today
        </button>
        <button className="btn btn-primary" onClick={continuePastBudget}>
          Keep studying
        </button>
      </StudyMessage>
    );
  }

  if (done || !card) {
    return (
      <StudyComplete
        stats={stats}
        emptyTitle="Nothing queued right now"
        emptyBody="Your plan has no cards ready in this queue."
        subtitle={[
          formatSessionLength(startedAt.current),
          "won't change your regular schedule",
        ].join(" · ")}
      >
        <button className="btn btn-secondary" onClick={() => router.push(`/cram/${planId}`)}>
          Back to plan
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setStats(EMPTY_STATS);
            void loadQueue(continueBeyondBudget);
          }}
        >
          {sessionCompleted === 0 ? "Refresh" : "Study more"}
        </button>
      </StudyComplete>
    );
  }

  return (
    <CramCardView
      card={card}
      plan={plan}
      planId={planId}
      revealed={revealed}
      submitting={submitting}
      budgetPrompt={budgetPrompt}
      counts={counts}
      meta={meta}
      sessionCompleted={sessionCompleted}
      error={error}
      grade={grade}
      setRevealed={setRevealed}
      textScaleIndex={textScaleIndex}
      onTextScaleChange={setTextScale}
      audioAutoplay={audioAutoplay}
      onAudioAutoplayChange={setAudioAutoplay}
      onCardUpdated={(updated) => {
        setQueue((prev) =>
          prev.map((c, i) =>
            i === idx
              ? {
                  ...c,
                  front: updated.front,
                  back: updated.back,
                  cloze_text: updated.cloze_text,
                  extra: updated.extra,
                  occlusion_data: updated.occlusion_data,
                  type: updated.type,
                }
              : c,
          ),
        );
      }}
      onSuspendCard={() => void suspendCurrentCard()}
      onContinuePastBudget={continuePastBudget}
      onFinishForToday={() => router.push(`/cram/${planId}`)}
    />
  );
}

function CramCardView({
  card,
  plan,
  planId,
  revealed,
  submitting,
  budgetPrompt,
  counts,
  meta,
  sessionCompleted,
  error,
  grade,
  setRevealed,
  textScaleIndex,
  onTextScaleChange,
  audioAutoplay,
  onAudioAutoplayChange,
  onCardUpdated,
  onSuspendCard,
  onContinuePastBudget,
  onFinishForToday,
}: {
  card: CramCard;
  plan: CramPlan | null;
  planId: string;
  revealed: boolean;
  submitting: boolean;
  budgetPrompt: boolean;
  counts: QueueCounts;
  meta: QueueMeta;
  sessionCompleted: number;
  error: string | null;
  grade: (gradeId: StudyGradeId) => void;
  setRevealed: (value: boolean) => void;
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  audioAutoplay: boolean;
  onAudioAutoplayChange: (enabled: boolean) => void;
  onCardUpdated: (updated: StudyCardData) => void;
  onSuspendCard: () => void;
  onContinuePastBudget: () => void;
  onFinishForToday: () => void;
}) {
  const [panelMode, setPanelMode] = useStudyPanel(card.item_id);
  useAutoplayCardAudio({
    cardKey: card.queue_key,
    questionFields: card.type === "cloze" ? [card.cloze_text] : [card.front],
    answerFields: card.type === "cloze" ? [card.extra] : [card.back, card.extra],
    revealed,
    enabled: audioAutoplay,
  });

  useStudyShortcuts({
    panelMode,
    setPanelMode,
    revealed,
    onReveal: () => setRevealed(true),
    onGrade: grade,
    gradingBlocked: budgetPrompt,
    onSuspend: () => {
      if (!submitting) onSuspendCard();
    },
    textScaleIndex,
    onTextScaleChange,
  });

  const readiness = readinessPercent(meta.readiness);
  // Progress across everything queued for this cram session today.
  const total = sessionCompleted + counts.remaining;
  const progress = total > 0 ? Math.min(100, (sessionCompleted / total) * 100) : 100;
  const position =
    meta.dailyBudget === null
      ? `${Math.min(sessionCompleted + 1, Math.max(total, 1))} of ${Math.max(total, 1)}`
      : `${Math.min(meta.reviewedToday + 1, Math.max(meta.reviewedToday, meta.dailyBudget))} of ${meta.dailyBudget} today`;

  return (
    <StudyFrame
      header={
        <StudyHeader
          backHref={`/cram/${planId}`}
          backLabel="Back to plan"
          title={plan?.name?.trim() || plan?.title?.trim() || "Cram plan"}
          titleHref={`/cram/${planId}`}
          position={position}
          detail={deadlineSummary(plan)}
          panelMode={panelMode}
          onPanelChange={setPanelMode}
          more={
            <StudyMoreMenu
              onSuspend={onSuspendCard}
              suspendDisabled={submitting}
              textScaleIndex={textScaleIndex}
              onTextScaleChange={onTextScaleChange}
              audioAutoplay={audioAutoplay}
              onAudioAutoplayChange={onAudioAutoplayChange}
            />
          }
        />
      }
      progress={progress}
      notices={
        <>
          <StudyError message={error} />
          {budgetPrompt ? (
            <div className="dh-note dh-study__notice" role="status">
              <i className="ri-time-line" aria-hidden />
              <span>
                <strong>Daily budget reached.</strong> You&apos;ve met today&apos;s planned effort.
                Continuing is optional.
              </span>
              <span className="dh-study__notice-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onFinishForToday}>
                  Finish for today
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onContinuePastBudget}>
                  Keep studying
                </button>
              </span>
            </div>
          ) : null}
        </>
      }
      card={
        <StudyCardFace
          card={card}
          cardKey={card.item_id}
          revealed={revealed}
          textScaleIndex={textScaleIndex}
        />
      }
      dock={
        <StudyDock
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onGrade={grade}
          intervals={card.intervals}
          disabled={submitting || budgetPrompt}
        />
      }
      meta={
        <StudyMeta
          spread
          left={
            <span className="dh-study__cram-note" title="Cram sessions don't change your regular review schedule.">
              <i className="ri-flashlight-line" aria-hidden />
              Cram session · won&apos;t change your regular schedule
            </span>
          }
          center={`${counts.due} due · ${counts.new} new · ${counts.remaining} left`}
          right={
            readiness === null ? null : (
              <span title="How ready you are for the test right now, before today's remaining reviews">
                Current readiness {readiness}%
              </span>
            )
          }
        />
      }
      panel={
        panelMode ? (
          <StudyCardPanel
            key={panelMode}
            mode={panelMode}
            card={card}
            onClose={() => setPanelMode(null)}
            onSaved={onCardUpdated}
          />
        ) : null
      }
    />
  );
}

/** "Deadline Nov 20, 14 days left", shown beside the position. */
function deadlineSummary(plan: CramPlan | null): string {
  const deadline = plan?.deadline_at ?? plan?.deadline ?? null;
  if (!deadline) return "No deadline";
  const daysLeft = daysUntil(deadline);
  const date = `Deadline ${formatShortDate(deadline, plan?.deadline_timezone ?? plan?.timezone)}`;
  if (daysLeft === null) return date;
  if (daysLeft < 0) return `${date}, passed`;
  if (daysLeft === 0) return `${date}, today`;
  return `${date}, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

function queueCounts(value: CramQueueResponse): QueueCounts {
  const counts = isRecord(value.counts) ? value.counts : {};
  return {
    due: finiteNumber(counts.due) ?? 0,
    new: finiteNumber(counts.new) ?? 0,
    remaining: finiteNumber(counts.remaining) ?? 0,
    total: finiteNumber(counts.total) ?? 0,
  };
}

function queueMeta(value: CramQueueResponse): QueueMeta {
  const today = value.today;
  return {
    dailyBudget: finiteNumber(today?.review_capacity) ?? finiteNumber(value.daily_budget),
    reviewedToday:
      finiteNumber(today?.reviews_completed) ?? finiteNumber(value.reviewed_today) ?? 0,
    remainingToday:
      finiteNumber(today?.reviews_remaining) ?? finiteNumber(value.remaining_today),
    budgetReached: today?.budget_reached === true || value.budget_reached === true,
    readiness: readinessValue(value.readiness) ?? finiteNumber(value.readiness_score),
  };
}

function mergeQueueMeta(previous: QueueMeta, payload: Record<string, unknown>): QueueMeta {
  const today = isRecord(payload.today) ? payload.today : null;
  const dailyBudget =
    finiteNumber(today?.review_capacity) ??
    finiteNumber(payload.daily_budget) ??
    previous.dailyBudget;
  const reviewedToday =
    finiteNumber(today?.reviews_completed) ??
    finiteNumber(payload.reviewed_today) ??
    previous.reviewedToday + 1;
  const remainingToday =
    finiteNumber(today?.reviews_remaining) ??
    finiteNumber(payload.remaining_today) ??
    (previous.remainingToday === null ? null : Math.max(0, previous.remainingToday - 1));
  const reachedFromCounts = dailyBudget !== null && reviewedToday >= dailyBudget;
  return {
    dailyBudget,
    reviewedToday,
    remainingToday,
    budgetReached:
      today?.budget_reached === true ||
      payload.budget_reached === true ||
      payload.soft_budget_reached === true ||
      reachedFromCounts ||
      previous.budgetReached,
    readiness:
      readinessValue(payload.readiness) ??
      finiteNumber(payload.readiness_score) ??
      previous.readiness,
  };
}

function readinessValue(value: unknown): number | null {
  if (isRecord(value)) {
    return (
      finiteNumber(value.target_coverage) ?? finiteNumber(value.mean_retrievability)
    );
  }
  return finiteNumber(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function daysUntil(iso: string): number | null {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.ceil((timestamp - Date.now()) / 86_400_000);
}

function formatShortDate(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}
