"use client";

import Link from "next/link";
import { parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { FadeIn } from "@/components/motion/fade-in";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import {
  StudySessionToolbar,
  STUDY_ACTION_SHORTCUTS,
} from "@/components/study-session-toolbar";
import {
  REVIEW_CHROME_INNER_RADIUS,
  STUDY_GRADES,
  studyReviewStyles as s,
  type StudyGradeId,
} from "@/components/study-review-chrome";
import { StudyCardSkeleton } from "@/components/ui/skeleton-patterns";
import { apiFetch } from "@/lib/api/fetch";
import { motionTransition, slideLeft } from "@/lib/motion";
import {
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  clampStudyTextScaleIndex,
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
import "@/components/rich-text/rich-text.css";
import "./cram.css";

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
  const [meta, setMeta] = useState<QueueMeta>(EMPTY_META);
  /** Sticky for the session once the user chooses to study past the budget. */
  const [continueBeyondBudget, setContinueBeyondBudget] = useState(false);
  const [textScaleIndex, setTextScaleIndex] = useState(DEFAULT_STUDY_TEXT_SCALE_INDEX);
  const shownAtRef = useRef(Date.now());

  useEffect(() => {
    setTextScaleIndex(readStoredStudyTextScaleIndex());
  }, []);

  const setTextScale = useCallback((next: number) => {
    setTextScaleIndex(next);
    writeStoredStudyTextScaleIndex(next);
  }, []);

  const fetchQueue = useCallback(
    async (continuePastBudget: boolean) => {
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
      return { root, cards };
    },
    [planId],
  );

  const loadQueue = useCallback(
    async (continuePastBudget = false) => {
      setLoading(true);
      setError(null);
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
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load the cram queue.");
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
        if (!response.ok) throw new Error(getErrorMessage(payload, "Could not save this review."));
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

  if (loading || refilling) {
    return (
      <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <StudyCardSkeleton />
          </FadeIn>
        </div>
      </div>
    );
  }

  if (error && queue.length === 0 && !done) {
    return (
      <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-error-warning-line" style={{ fontSize: 32, color: "var(--grade-again)" }} />
              <p style={{ marginTop: 12, color: "var(--fg-3)" }}>{error}</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void loadQueue()}>
                Retry
              </button>
            </div>
          </FadeIn>
        </div>
      </div>
    );
  }

  if (budgetChoice) {
    return (
      <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-time-line" style={{ fontSize: 48, color: "var(--orange-500)" }} />
              <h2 className="display-xs" style={{ marginTop: 16 }}>
                Daily budget reached
              </h2>
              <p style={{ color: "var(--fg-3)", marginTop: 8 }}>
                You&apos;ve met today&apos;s planned effort
                {meta.dailyBudget !== null ? ` (${meta.reviewedToday} / ${meta.dailyBudget} reviews)` : ""}.
                Continuing is optional and won&apos;t affect normal Study Mode.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={() => router.push(`/cram/${planId}`)}>
                  Finish for today
                </button>
                <button className="btn btn-primary" onClick={continuePastBudget}>
                  Keep studying
                </button>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    );
  }

  if (done || !card) {
    return (
      <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-check-double-line" style={{ fontSize: 48, color: "var(--grade-easy)" }} />
              <h2 className="display-xs" style={{ marginTop: 16 }}>
                {sessionCompleted === 0 ? "Nothing queued right now" : "Cram session complete"}
              </h2>
              <p style={{ color: "var(--fg-3)", marginTop: 8 }}>
                {sessionCompleted === 0
                  ? "Your plan has no cards ready in this queue."
                  : `You reviewed ${sessionCompleted.toLocaleString()} card${sessionCompleted === 1 ? "" : "s"}.`}
              </p>
              {sessionCompleted > 0 && (
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
                  {STUDY_GRADES.map((g, i) => (
                    <m.div
                      key={g.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.24 }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 8,
                        background: g.bg,
                        color: g.color,
                        font: "500 13px/16px var(--font-sans)",
                      }}
                    >
                      {g.label}: {stats[g.id]}
                    </m.div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setStats(EMPTY_STATS);
                    void loadQueue(continueBeyondBudget);
                  }}
                >
                  {sessionCompleted === 0 ? "Refresh" : "Study More"}
                </button>
                <button className="btn btn-primary" onClick={() => router.push(`/cram/${planId}`)}>
                  Back to plan
                </button>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
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
  onCardUpdated: (updated: StudyCardData) => void;
  onSuspendCard: () => void;
  onContinuePastBudget: () => void;
  onFinishForToday: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const transition = motionTransition(undefined, undefined, reducedMotion ?? false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
  const cardTextStyle = studyCardTextStyle(STUDY_TEXT_SCALE_STEPS[textScaleIndex]);

  useEffect(() => {
    setPanelMode(null);
  }, [card.item_id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (panelMode) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealed) {
          setRevealed(true);
        } else if (!budgetPrompt) {
          grade("good");
        }
        return;
      }

      if (revealed && !budgetPrompt && ["1", "2", "3", "4"].includes(e.key)) {
        grade(STUDY_GRADES[Number(e.key) - 1].id);
        return;
      }

      if (e.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.edit.toLowerCase()) {
        e.preventDefault();
        setPanelMode("edit");
        return;
      }
      if (e.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.explain.toLowerCase()) {
        e.preventDefault();
        setPanelMode("explain");
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.suspend) {
        e.preventDefault();
        if (!submitting) onSuspendCard();
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.zoomOut) {
        e.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex - 1));
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.zoomIn) {
        e.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    budgetPrompt,
    grade,
    onSuspendCard,
    onTextScaleChange,
    panelMode,
    revealed,
    setRevealed,
    submitting,
    textScaleIndex,
  ]);

  const readiness = readinessPercent(meta.readiness);

  return (
    <>
      <div className="study-mode-page">
        <div style={s.wrap}>
          <CramSessionBanner plan={plan} planId={planId} meta={meta} />

          <AnimatePresence>
            {error ? (
              <m.div
                key="cram-error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={transition}
                style={s.errorBanner}
                role="alert"
              >
                {error}
              </m.div>
            ) : null}
          </AnimatePresence>

          {budgetPrompt ? (
            <div className="cram-budget-prompt" role="status">
              <div>
                <strong>Daily budget reached</strong>
                <span>You&apos;ve met today&apos;s planned effort. Continuing is optional.</span>
              </div>
              <div className="cram-budget-prompt-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onFinishForToday}>
                  Finish for today
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onContinuePastBudget}>
                  Keep studying
                </button>
              </div>
            </div>
          ) : null}

          <div className="study-mode-stage-row">
            <div className="study-mode-stage">
              <div style={s.cardChrome}>
                <AnimatePresence mode="wait">
                  <m.div
                    key={card.item_id}
                    className="study-card-face"
                    variants={slideLeft}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={transition}
                  >
                    <div className="study-card-question">
                      <div style={cardTextStyle}>
                        <CramCardQuestion card={card} revealed={revealed} />
                      </div>
                    </div>

                    <div className="study-card-answer">
                      <AnimatePresence>
                        {revealed ? (
                          <CramCardAnswer
                            card={card}
                            textStyle={cardTextStyle}
                            transition={transition}
                          />
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </m.div>
                </AnimatePresence>

                <div style={s.progressBar}>
                  {/* Progress across everything queued for this cram session today. */}
                  <div
                    style={{
                      ...s.progressFill,
                      background: "var(--orange-500)",
                      width: `${(() => {
                        const total = sessionCompleted + counts.remaining;
                        if (total <= 0) return 100;
                        return Math.min(100, (sessionCompleted / total) * 100);
                      })()}%`,
                    }}
                  />
                </div>
              </div>

              <div style={s.reviewChrome}>
                <div style={s.reviewPrimaryRow}>
                  <AnimatePresence mode="wait" initial={false}>
                    {revealed ? (
                      <m.div
                        key="grades"
                        style={s.gradeBar}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14 }}
                      >
                        {STUDY_GRADES.map((g, i) => (
                          <m.button
                            key={g.id}
                            className="study-grade-btn"
                            title={g.hint}
                            aria-label={`${g.label} — ${g.hint}`}
                            onClick={() => grade(g.id)}
                            disabled={submitting || budgetPrompt}
                            whileHover={{ backgroundColor: g.bg }}
                            whileTap={{ scale: 0.98 }}
                            style={{
                              ...s.gradeBtn,
                              borderRight: i === STUDY_GRADES.length - 1 ? 0 : "1px solid var(--border-1)",
                              borderTopLeftRadius: i === 0 ? REVIEW_CHROME_INNER_RADIUS : 0,
                              borderTopRightRadius:
                                i === STUDY_GRADES.length - 1 ? REVIEW_CHROME_INNER_RADIUS : 0,
                              cursor: submitting || budgetPrompt ? "not-allowed" : "pointer",
                            }}
                          >
                            <span className="study-shortcut-popup" role="tooltip">
                              {g.id === "good" ? "3 · Space" : String(i + 1)}
                            </span>
                            <div style={{ font: "600 14px/1 var(--font-sans)", color: g.color, width: "100%", textAlign: "center" }}>
                              {g.label}
                            </div>
                            <div style={s.gradeMeta}>{card.intervals?.[g.id] ?? "—"}</div>
                          </m.button>
                        ))}
                      </m.div>
                    ) : (
                      <m.button
                        key="show"
                        type="button"
                        className="study-show-btn"
                        onClick={() => setRevealed(true)}
                        style={s.showBtn}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14 }}
                        whileTap={{ scale: 0.995 }}
                      >
                        <span className="study-shortcut-popup" role="tooltip">
                          Space
                        </span>
                        <span>Show Answer</span>
                      </m.button>
                    )}
                  </AnimatePresence>
                </div>
                <div style={s.reviewFooterBar}>
                  <div style={s.reviewFooterSide}>
                    <span style={footerMetaStyle}>
                      {meta.dailyBudget === null
                        ? `${meta.reviewedToday} reviewed today`
                        : `${meta.reviewedToday} / ${meta.dailyBudget} today`}
                    </span>
                  </div>
                  <div style={s.reviewFooterCenter}>
                    <span className="chip chip-due">
                      <span className="chip-dot" />
                      {counts.due} due
                    </span>
                    <span className="chip chip-new">
                      <span className="chip-dot" />
                      {counts.new} new
                    </span>
                    <span className="chip chip-neutral">
                      <span className="chip-dot" />
                      {counts.remaining} left
                    </span>
                  </div>
                  <div style={{ ...s.reviewFooterSide, justifyContent: "flex-end" }}>
                    <span
                      style={footerMetaStyle}
                      title="How ready you are for the test right now, before today's remaining reviews"
                    >
                      {readiness === null ? "" : `Current readiness ${readiness}%`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <StudySessionToolbar
              placement="side"
              textScaleIndex={textScaleIndex}
              onTextScaleChange={onTextScaleChange}
              onEdit={() => setPanelMode("edit")}
              onExplain={() => setPanelMode("explain")}
              onSuspend={onSuspendCard}
              suspendDisabled={submitting}
            />
          </div>
        </div>

        <AnimatePresence>
          {panelMode ? (
            <StudyCardPanel
              key="study-card-panel"
              mode={panelMode}
              card={card}
              onClose={() => setPanelMode(null)}
              onSaved={onCardUpdated}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}

/** Visual indicator that this is a cram session, not normal Study Mode. */
function CramSessionBanner({
  plan,
  planId,
  meta,
}: {
  plan: CramPlan | null;
  planId: string;
  meta: QueueMeta;
}) {
  const deadline = plan?.deadline_at ?? plan?.deadline ?? null;
  const daysLeft = deadline ? daysUntil(deadline) : null;
  return (
    <div className="cram-session-banner">
      <span
        className="cram-session-badge"
        title="Cram sessions don't change your regular review schedule."
      >
        <i className="ri-flashlight-fill" aria-hidden />
        Cram session
      </span>
      <Link href={`/cram/${planId}`} className="cram-session-plan">
        {plan?.name?.trim() || plan?.title?.trim() || "Cram plan"}
      </Link>
      <span className="cram-session-meta">
        {deadline
          ? `Deadline ${formatShortDate(deadline, plan?.deadline_timezone ?? plan?.timezone)}${
              daysLeft !== null
                ? ` · ${
                    daysLeft < 0
                      ? "deadline passed"
                      : daysLeft === 0
                        ? "today"
                        : daysLeft === 1
                          ? "1 day left"
                          : `${daysLeft} days left`
                  }`
                : ""
            }`
          : "No deadline"}
      </span>
      {meta.dailyBudget !== null ? (
        <span className="cram-session-budget">
          {meta.reviewedToday} / {meta.dailyBudget} today
        </span>
      ) : null}
    </div>
  );
}

function CramCardQuestion({ card, revealed }: { card: CramCard; revealed: boolean }) {
  if (card.type === "image-occlusion") {
    const caption = parseCardContent(card.front ?? "")
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.value)
      .join("\n")
      .trim();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
        {caption ? <CardContentRenderer content={caption} studyView /> : null}
        <OcclusionRenderer
          data={parseImageOcclusionData(card.occlusion_data)}
          activeOrd={card.cloze_ord}
          revealed={revealed}
          studyView
        />
      </div>
    );
  }
  if (card.type === "cloze" && card.cloze_text) {
    return (
      <CardContentRenderer
        content={card.cloze_text}
        clozeMode={revealed ? "revealed" : "hidden"}
        activeClozeOrd={card.cloze_ord}
        studyView
      />
    );
  }
  return <CardContentRenderer content={card.front} studyView />;
}

function CramCardAnswer({
  card,
  textStyle,
  transition,
}: {
  card: CramCard;
  textStyle: React.CSSProperties;
  transition: object;
}) {
  const answer = card.type === "cloze" ? card.extra : (card.back ?? card.extra);
  if (!answer) return null;
  return (
    <m.div
      key="back"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}
    >
      <div style={s.divider} />
      <div style={textStyle}>
        <CardContentRenderer content={answer} studyView />
      </div>
    </m.div>
  );
}

const footerMetaStyle: React.CSSProperties = {
  font: "500 12px/16px var(--font-sans)",
  color: "var(--fg-4)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function daysUntil(iso: string): number | null {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.ceil((timestamp - Date.now()) / 86_400_000);
}

function formatShortDate(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
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
