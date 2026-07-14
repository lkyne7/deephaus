"use client";

import { parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyCardPanel } from "@/components/study-card-panel";
import { StudyCardTags } from "@/components/study-card-tags";
import { StudySessionToolbar } from "@/components/study-session-toolbar";
import { apiFetch } from "@/lib/api/fetch";
import {
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  readStoredStudyTextScaleIndex,
  STUDY_TEXT_SCALE_STEPS,
  studyCardTextStyle,
  writeStoredStudyTextScaleIndex,
} from "@/lib/study/text-scale";
import {
  getErrorMessage,
  isRecord,
  normalizeQueueItem,
  readinessPercent,
  type CramCard,
  type CramPlan,
  type CramQueueResponse,
} from "./types";
import "./cram.css";

type Rating = 1 | 2 | 3 | 4;

const RATINGS: Array<{ rating: Rating; label: string; color: string }> = [
  { rating: 1, label: "Again", color: "var(--grade-again)" },
  { rating: 2, label: "Hard", color: "var(--grade-hard)" },
  { rating: 3, label: "Good", color: "var(--grade-good)" },
  { rating: 4, label: "Easy", color: "var(--grade-easy)" },
];

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

export function CramStudyMode({ planId }: { planId: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<CramPlan | null>(null);
  const [queue, setQueue] = useState<CramCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<QueueMeta>(EMPTY_META);
  const [continueBeyondBudget, setContinueBeyondBudget] = useState(false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
  const [textScaleIndex, setTextScaleIndex] = useState(DEFAULT_STUDY_TEXT_SCALE_INDEX);
  const shownAtRef = useRef(Date.now());
  const textStyle = useMemo(
    () => studyCardTextStyle(STUDY_TEXT_SCALE_STEPS[textScaleIndex] ?? STUDY_TEXT_SCALE_STEPS[DEFAULT_STUDY_TEXT_SCALE_INDEX]!),
    [textScaleIndex],
  );

  useEffect(() => {
    setTextScaleIndex(readStoredStudyTextScaleIndex());
  }, []);

  const setTextScale = useCallback((next: number) => {
    setTextScaleIndex(next);
    writeStoredStudyTextScaleIndex(next);
  }, []);

  const loadQueue = useCallback(async (continuePastBudget = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (continuePastBudget) params.set("continue", "1");
      const response = await apiFetch(`/api/cram-plans/${planId}/queue?${params}`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load the cram queue."));
      const root = isRecord(payload) ? (payload as CramQueueResponse) : {};
      const rawQueue = root.queue ?? root.items ?? root.cards ?? [];
      const cards = Array.isArray(rawQueue)
        ? rawQueue.map(normalizeQueueItem).filter((card): card is CramCard => card !== null)
        : [];
      setPlan(isRecord(root.plan) ? (root.plan as CramPlan) : null);
      setQueue(cards);
      setIndex(0);
      setRevealed(false);
      setDone(cards.length === 0);
      setContinueBeyondBudget(continuePastBudget);
      setMeta(queueMeta(root));
      shownAtRef.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the cram queue.");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const current = queue[index];

  useEffect(() => {
    setPanelMode(null);
  }, [current?.item_id]);

  const grade = useCallback(
    async (rating: Rating) => {
      if (!current || !revealed || submitting) return;
      setSubmitting(true);
      setError(null);
      const responseMs = Math.max(0, Date.now() - shownAtRef.current);
      try {
        const response = await apiFetch(`/api/cram-plans/${planId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: current.item_id,
            rating,
            response_ms: responseMs,
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(payload, "Could not save this review."));
        if (isRecord(payload)) {
          setMeta((previous) => mergeQueueMeta(previous, payload));
          if (payload.budget_reached === true || payload.soft_budget_reached === true) {
            setContinueBeyondBudget(false);
          }
        } else {
          setMeta((previous) => ({
            ...previous,
            reviewedToday: previous.reviewedToday + 1,
            remainingToday:
              previous.remainingToday === null ? null : Math.max(0, previous.remainingToday - 1),
          }));
        }
        if (index + 1 >= queue.length) {
          setDone(true);
        } else {
          setIndex((value) => value + 1);
          setRevealed(false);
          shownAtRef.current = Date.now();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save this review.");
      } finally {
        setSubmitting(false);
      }
    },
    [current, index, planId, queue.length, revealed, submitting],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (panelMode || isTypingTarget(event.target) || loading || done || submitting) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (revealed) void grade(3);
        else setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void grade(Number(event.key) as Rating);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [done, grade, loading, panelMode, revealed, submitting]);

  const suspendCurrentCard = useCallback(async () => {
    if (!current || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cards/${current.id}/suspend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: true }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to suspend card"));
      const suspendedIndex = index;
      setRevealed(false);
      setPanelMode(null);
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== suspendedIndex);
        if (next.length === 0) {
          setDone(true);
          setIndex(0);
        } else if (suspendedIndex >= next.length) {
          setIndex(next.length - 1);
        }
        return next;
      });
      shownAtRef.current = Date.now();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to suspend card");
    } finally {
      setSubmitting(false);
    }
  }, [current, index, submitting]);

  const budgetPrompt = meta.budgetReached && !continueBeyondBudget && !done;
  const budgetChoice = meta.budgetReached && !continueBeyondBudget && (done || !current);

  return (
    <>
      <div className="cram-study-page">
        <div className="cram-study-wrap">
          {loading ? (
            <StudyState icon="ri-loader-4-line icon-spin" title="Building your cram queue" copy="Prioritizing the next cards…" />
          ) : error && !current ? (
            <StudyState icon="ri-error-warning-line" title="Couldn’t load this session" copy={error}>
              <button type="button" className="btn btn-secondary" onClick={() => void loadQueue()}>
                Try again
              </button>
            </StudyState>
          ) : budgetChoice ? (
            <StudyState
              icon="ri-time-line"
              title="Daily budget reached"
              copy="You’ve met today’s planned effort. Continuing is optional and won’t affect normal Study Mode."
            >
              <div className="cram-budget-prompt-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => router.push(`/cram/${planId}`)}
                >
                  Finish for today
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void loadQueue(true)}
                >
                  Keep studying
                </button>
              </div>
            </StudyState>
          ) : done ? (
            <StudyState
              icon="ri-checkbox-circle-line"
              title={queue.length === 0 ? "Nothing queued right now" : "Cram session complete"}
              copy={
                queue.length === 0
                  ? "Your plan has no cards ready in this queue."
                  : `You reviewed ${queue.length.toLocaleString()} card${queue.length === 1 ? "" : "s"}.`
              }
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => router.push(`/cram/${planId}`)}
              >
                Back to plan
              </button>
            </StudyState>
          ) : current ? (
            <>
              <StudySessionToolbar
                textScaleIndex={textScaleIndex}
                onTextScaleChange={setTextScale}
                onEdit={() => setPanelMode("edit")}
                onExplain={() => setPanelMode("explain")}
                onSuspend={() => void suspendCurrentCard()}
                suspendDisabled={submitting}
              />
              <StudySummary meta={meta} current={index + 1} total={queue.length} />
              {budgetPrompt ? (
                <div className="cram-budget-prompt" role="status">
                  <div>
                    <strong>Daily budget reached</strong>
                    <span>You&apos;ve met today&apos;s planned effort. Continuing is optional.</span>
                  </div>
                  <div className="cram-budget-prompt-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => router.push(`/cram/${planId}`)}
                    >
                      Finish for today
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setContinueBeyondBudget(true)}
                    >
                      Keep studying
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="cram-study-card">
                <div className="cram-study-chip-row">
                  <span className="chip chip-due">
                    <span className="chip-dot" />
                    Card {index + 1} of {queue.length}
                  </span>
                  <span className="chip chip-neutral">Cram plan</span>
                </div>
                <div className="cram-study-content">
                  <div className="cram-study-question">
                    <CramCardQuestion card={current} revealed={revealed} textStyle={textStyle} />
                  </div>
                  {revealed ? (
                    <div className="cram-study-answer">
                      <CramCardAnswer card={current} textStyle={textStyle} />
                    </div>
                  ) : null}
                </div>
                <StudyCardTags tags={current.tags} />
                <div className="cram-study-progress">
                  <span style={{ width: `${((index + (revealed ? 1 : 0)) / queue.length) * 100}%` }} />
                </div>
              </div>
              <div className="cram-review-controls">
                {revealed ? (
                  <div className="cram-grade-grid">
                    {RATINGS.map(({ rating, label, color }) => (
                      <button
                        key={rating}
                        type="button"
                        className="cram-grade study-grade-btn"
                        style={{ color }}
                        onClick={() => void grade(rating)}
                        disabled={submitting || budgetPrompt}
                      >
                        <span className="study-shortcut-popup" role="tooltip">
                          {rating === 3 ? "3 · Space" : rating}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cram-show-answer study-show-btn"
                    onClick={() => setRevealed(true)}
                    disabled={budgetPrompt}
                  >
                    <span className="study-shortcut-popup" role="tooltip">Space</span>
                    Show Answer
                  </button>
                )}
              </div>
              {error ? <div className="cram-error">{error}</div> : null}
            </>
          ) : null}
        </div>
      </div>
      <AnimatePresence>
        {panelMode && current ? (
          <StudyCardPanel
            key="study-card-panel"
            mode={panelMode}
            card={current}
            onClose={() => setPanelMode(null)}
            onSaved={(updated) => {
              setQueue((prev) =>
                prev.map((card, i) =>
                  i === index
                    ? {
                        ...card,
                        front: updated.front,
                        back: updated.back,
                        cloze_text: updated.cloze_text,
                        extra: updated.extra,
                        occlusion_data: updated.occlusion_data,
                        type: updated.type,
                      }
                    : card,
                ),
              );
            }}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function StudySummary({ meta, current, total }: { meta: QueueMeta; current: number; total: number }) {
  const readiness = readinessPercent(meta.readiness);
  return (
    <div className="cram-study-summary">
      <div className="cram-study-summary-item">
        <span>Daily budget</span>
        <strong>
          {meta.dailyBudget === null
            ? `${meta.reviewedToday} reviewed`
            : `${meta.reviewedToday} / ${meta.dailyBudget}`}
        </strong>
      </div>
      <div className="cram-study-summary-item">
        <span>Readiness</span>
        <strong>{readiness === null ? "—" : `${readiness}%`}</strong>
      </div>
      <div className="cram-study-summary-item">
        <span>Session</span>
        <strong>{current} / {total}</strong>
      </div>
    </div>
  );
}

function CramCardQuestion({
  card,
  revealed,
  textStyle,
}: {
  card: CramCard;
  revealed: boolean;
  textStyle: React.CSSProperties;
}) {
  if (card.type === "image-occlusion") {
    const caption = parseCardContent(card.front ?? "")
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.value)
      .join("\n")
      .trim();
    return (
      <div style={{ display: "flex", width: "100%", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {caption ? (
          <div style={textStyle}>
            <CardContentRenderer content={caption} studyView />
          </div>
        ) : null}
        <OcclusionRenderer
          data={parseImageOcclusionData(card.occlusion_data)}
          activeOrd={card.cloze_ord}
          revealed={revealed}
          studyView
        />
      </div>
    );
  }
  if (card.type === "cloze") {
    return (
      <div style={textStyle}>
        <CardContentRenderer
          content={card.cloze_text}
          clozeMode={revealed ? "revealed" : "hidden"}
          activeClozeOrd={card.cloze_ord}
          studyView
        />
      </div>
    );
  }
  return (
    <div style={textStyle}>
      <CardContentRenderer content={card.front} studyView />
    </div>
  );
}

function CramCardAnswer({ card, textStyle }: { card: CramCard; textStyle: React.CSSProperties }) {
  const answer = card.type === "cloze" ? card.extra : (card.back ?? card.extra);
  if (!answer) return null;
  return (
    <>
      <div className="cram-study-divider" />
      <div style={textStyle}>
        <CardContentRenderer content={answer} studyView />
      </div>
    </>
  );
}

function StudyState({
  icon,
  title,
  copy,
  children,
}: {
  icon: string;
  title: string;
  copy: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="cram-state" style={{ flex: 1 }}>
      <i className={icon} aria-hidden />
      <h2>{title}</h2>
      <p>{copy}</p>
      {children}
    </div>
  );
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
  const reachedFromCounts =
    dailyBudget !== null && reviewedToday >= dailyBudget;
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
      finiteNumber(value.target_coverage) ??
      finiteNumber(value.mean_retrievability)
    );
  }
  return finiteNumber(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}
