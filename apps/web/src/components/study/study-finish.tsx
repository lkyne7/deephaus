"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type ExamListResponse,
  type ExamSummaryDto,
  type FinishGradeCounts,
  type FinishLeft,
  type FinishSession,
  type SittingAnswer,
  type StudyFinishDeck,
  type StudyFinishResponse,
  studyQueueQuery,
  type StudyQueueOptions,
} from "@deephaus/shared";
import { FadeIn } from "@/components/motion/fade-in";
import { STUDY_ACTION_SHORTCUTS, STUDY_GRADES } from "@/components/study-review-chrome";
import { StudyLookOver } from "@/components/study/study-look-over";
import { ignoresStudyShortcuts } from "@/components/study/use-study-session-controls";
import { StudySkeleton } from "@/components/study/study-chrome";
import { apiFetch } from "@/lib/api/fetch";
import { cacheKeys } from "@/lib/client-cache/keys";
import { prefetchReviewQueue } from "@/lib/study/review-cache";
import { studySitting, type SittingCard } from "@/lib/study/sitting";
import { deckHref } from "@/lib/decks/deck-link";

/**
 * Keys and clicks are ignored this long after the page appears: a student
 * grading with Space would otherwise start the next deck without seeing it.
 */
const INPUT_GUARD_MS = 600;
/** The page opens without what's left rather than wait longer than this. */
const LOAD_TIMEOUT_MS = 6_000;

type FinishData = {
  decks: StudyFinishDeck[] | null;
  exams: ExamSummaryDto[];
  streak?: number;
};

async function readJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadFinish(): Promise<FinishData> {
  const [finish, exams, stats] = await Promise.all([
    readJson<StudyFinishResponse>("/api/study/finish").catch(() => null),
    readJson<ExamListResponse>(cacheKeys.exams).catch(() => null),
    readJson<{ streak?: number }>(cacheKeys.dashboardStats).catch(() => null),
  ]);
  return {
    decks: finish?.decks ?? null,
    exams: (exams?.exams ?? []).filter((exam) => exam.status === "active"),
    streak: stats?.streak,
  };
}

/** "at 3:42 PM", or "tomorrow at 8:00 AM" and so on for later days. */
function formatFinishTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / 86_400_000);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${at.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

function deckStudyHref(deckId: string, options: StudyQueueOptions = {}): string {
  const query = studyQueueQuery(options);
  return `/decks/${deckId}/study${query ? `?${query}` : ""}`;
}

function reviewHref(options: StudyQueueOptions = {}): string {
  const query = studyQueueQuery(options);
  return `/review${query ? `?${query}` : ""}`;
}

function leftHref(entry: FinishLeft): string {
  return entry.kind === "exam" ? `/exams/${entry.id}/study` : deckStudyHref(entry.id);
}

export type FinishExamInfo = {
  examAt: string;
  target: number;
  recallStart: number;
  recallNow: number;
  nextAt: string | null;
  skipped: number;
};

export function StudyFinish({
  session,
  sessionKey,
  name,
  exam,
  backHref,
  backLabel,
  onUndo,
  onReload,
}: {
  session: FinishSession;
  /** Picks this session's answers out of the sitting. */
  sessionKey: string;
  name: string;
  exam: FinishExamInfo | null;
  backHref: string;
  backLabel: string;
  /** Takes back the last answer; absent when there is none. */
  onUndo?: () => void;
  /** Studies the same thing again, when there is more of it. */
  onReload: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<FinishData | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [amount, setAmount] = useState(10);
  const [lookingOver, setLookingOver] = useState(false);
  // Bumped when a missed card is edited, so its new text shows.
  const [edits, setEdits] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const readyAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const settle = (value: FinishData) => {
      if (!cancelled) setData((current) => current ?? value);
    };
    const timer = window.setTimeout(() => settle({ decks: null, exams: [] }), LOAD_TIMEOUT_MS);
    void loadFinish()
      .then(settle)
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const answers = useMemo(() => {
    void edits;
    return {
      session: studySitting.session(sessionKey),
      sitting: studySitting.all(),
    };
  }, [sessionKey, edits]);
  const own = useMemo(() => summarizeAnswers(answers.session), [answers]);
  const sitting = useMemo(() => summarizeAnswers(answers.sitting), [answers]);

  const plan = useMemo(
    () =>
      data
        ? finishPlan({
            session,
            reviewed: own.cards,
            newLearned: own.newCards,
            decks: data.decks,
            exams: data.exams.map((entry) => ({
              id: entry.id,
              name: entry.name.trim() || "Your exam",
              ready: entry.ready_now,
            })),
          })
        : null,
    [data, own, session],
  );
  // What the extras' "Look over missed cards" covers.
  const pool = useMemo(
    () => lookOverAnswers(answers.sitting, session, plan?.state),
    [answers, session, plan?.state],
  );
  const poolMisses = useMemo(() => summarizeAnswers(pool).misses.length, [pool]);

  // Warm the next deck so its first card is there as soon as it opens.
  const nextDeckId = plan?.next?.kind === "deck" ? plan.next.id : null;
  useEffect(() => {
    if (nextDeckId) prefetchReviewQueue(nextDeckId);
  }, [nextDeckId]);

  const shown = plan !== null && !lookingOver;
  useEffect(() => {
    if (!shown) return;
    readyAt.current = Date.now() + INPUT_GUARD_MS;
    heading.current?.focus({ preventScroll: true });
  }, [shown]);

  // Once the day is done the page adds up the whole sitting.
  const summary = plan?.state === "done" ? sitting : own;

  const go = (href: string) => {
    // Already here: the address wouldn't change, so start the session over.
    if (href === `${window.location.pathname}${window.location.search}`) onReload();
    else router.replace(href);
  };
  const leave = () => router.push(backHref);
  /** For the dock, where a double click on a grade would land. */
  const guarded = (run: () => void) => {
    if (Date.now() >= readyAt.current) run();
  };

  const actions = plan ? finishActions() : null;

  function finishActions() {
    const current = plan!;
    const done = { label: "Done", detail: "", run: leave };
    let primary = done;
    if (current.next?.kind === "deck") {
      const next = current.next;
      primary = {
        label: next.id === session.id ? "Keep going" : `Study ${next.title}`,
        detail: `${cardCount(next.cards)}, ${finishEstimate(next.cards)}`,
        run: () => go(deckStudyHref(next.id)),
      };
    } else if (current.next?.kind === "exam") {
      const next = current.next;
      primary = {
        label: `Study for ${next.title}`,
        detail: `${cardCount(next.cards)}, ${finishEstimate(next.cards)}`,
        run: () => go(`/exams/${next.id}/study`),
      };
    } else if (current.next) {
      const next = current.next;
      primary = {
        label: "Study today's cards",
        detail: `${cardCount(next.cards)}, ${finishEstimate(next.cards)}`,
        run: () => go(reviewHref()),
      };
    }

    const extras =
      current.extras.learn !== null ||
      current.extras.ahead !== null ||
      current.returning !== null ||
      poolMisses > 0;
    let secondary: { label: string; key: string; run: () => void } | null = null;
    if (current.state === "limit" && current.held) {
      const held = current.held;
      secondary = {
        label: `Do the ${held.cards.toLocaleString()} now`,
        key: "F",
        run: () => go(deckStudyHref(held.deckId, { allReviews: true })),
      };
    } else if (current.state === "returning" && current.returning) {
      const back = current.returning;
      secondary = {
        label: back.cards === 1 ? "Finish it now" : `Finish the ${back.cards.toLocaleString()} now`,
        key: "F",
        run: () =>
          go(back.deckId ? deckStudyHref(back.deckId, { learning: true }) : reviewHref({ learning: true })),
      };
    } else if (current.next) {
      secondary = {
        label: current.state === "empty" ? backLabel : "Done",
        key: "Esc",
        run: leave,
      };
    } else if (session.kind === "exam" || current.state === "unknown") {
      secondary = { label: "Check again", key: "", run: onReload };
    } else if (current.state !== "empty" && current.state !== "learned" && current.state !== "ahead" && extras) {
      secondary = {
        label: showMore ? "Back" : "Study more",
        key: "M",
        run: () => setShowMore((open) => !open),
      };
    }
    return { primary, secondary };
  }

  useEffect(() => {
    if (!shown || !actions) return;
    const { primary, secondary } = actions;
    function onKey(event: KeyboardEvent) {
      if (ignoresStudyShortcuts(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const key = event.key;
      if (Date.now() < readyAt.current) {
        // Not answered yet, but Space mustn't scroll the page either.
        if (key === " ") event.preventDefault();
        return;
      }
      if (key === " " || key === "Enter") {
        // A focused link or button answers for itself.
        if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
        event.preventDefault();
        primary.run();
      } else if (key === "Escape") {
        event.preventDefault();
        leave();
      } else if (key === STUDY_ACTION_SHORTCUTS.undo && onUndo) {
        event.preventDefault();
        onUndo();
      } else if (secondary && secondary.key.length === 1 && key.toUpperCase() === secondary.key) {
        event.preventDefault();
        secondary.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!plan || !actions) return <StudySkeleton />;

  if (lookingOver) {
    return (
      <StudyLookOver
        misses={sittingMisses(plan.state === "done" || showMore || own.misses.length === 0 ? pool : answers.session)}
        onCardUpdated={(updated) => {
          studySitting.updateCard(
            (card) => card.id === updated.id,
            (card) => ({ ...card, ...updated, cloze_ord: card.cloze_ord }),
          );
          setEdits((count) => count + 1);
        }}
        onStop={() => setLookingOver(false)}
      />
    );
  }

  const copy = finishCopy({
    plan,
    session,
    summary,
    name,
    streak: data?.streak,
    formatTime: formatFinishTime,
    exam: exam ? { daysLeft: daysUntil(exam.examAt), nextAt: exam.nextAt } : null,
  });
  // An exam has its own rows; more of a deck isn't more of the exam.
  const showExtras =
    session.kind !== "exam" &&
    (showMore || plan.state === "empty" || plan.state === "learned" || plan.state === "ahead");
  const missed = summary.misses.length;

  return (
    <div className="dh-study">
      <div className="dh-study__main">
        <header className="dh-study__top">
          <div className="dh-study__bar">
            <div className="dh-study__where">
              <Link href={backHref} className="dh-study__icon-btn" aria-label={backLabel} title={backLabel}>
                <i className="ri-close-line" aria-hidden />
              </Link>
              <div className="dh-study__heading">
                <span className="dh-study__title">{session.kind === "all" ? "Today" : name}</span>
              </div>
            </div>
            <div className="dh-study__progress" aria-hidden>
              <span style={{ width: "100%" }} />
            </div>
            <div className="dh-study__tools">
              {onUndo ? (
                <button type="button" className="dh-finish__undo" onClick={onUndo}>
                  <i className="ri-arrow-go-back-line" aria-hidden />
                  Undo last answer
                  <kbd className="dh-kbd" aria-hidden>←</kbd>
                </button>
              ) : null}
            </div>
          </div>
        </header>
        <div className="dh-finish__mid">
          <FadeIn className="dh-finish">
            <h1 className="dh-title dh-finish__title" tabIndex={-1} ref={heading}>
              {copy.title}
            </h1>
            {copy.subtitle ? <p className="dh-finish__sub">{copy.subtitle}</p> : null}

            {summary.cards > 0 && !showMore ? (
              <GradeSplit
                first={summary.first}
                action={
                  missed > 0 ? (
                    <button type="button" className="dh-finish__link" onClick={() => setLookingOver(true)}>
                      {missed === 1 ? "Look over the one you missed" : `Look over the ${missed} you missed`}
                    </button>
                  ) : null
                }
              />
            ) : null}

            {showExtras ? (
              <FinishSection
                label={plan.state === "empty" && session.kind === "deck" && name ? `More from ${name}` : "Study more"}
              >
                {poolMisses > 0 && (showMore || plan.state === "empty") ? (
                  <FinishRow
                    icon="ri-eye-line"
                    title="Look over missed cards"
                    detail="See the answers again with Explain. Nothing is rescheduled."
                    end={cardCount(poolMisses)}
                    onClick={() => setLookingOver(true)}
                  />
                ) : null}
                {plan.extras.learn ? (
                  <LearnRow
                    learn={plan.extras.learn}
                    amount={amount}
                    onAmount={setAmount}
                    onStart={(count) =>
                      go(
                        deckStudyHref(plan.extras.learn!.deckId, {
                          newLimit: learnMoreLimit(plan.extras.learn!, count),
                        }),
                      )
                    }
                  />
                ) : null}
                {plan.held && plan.state !== "limit" ? (
                  <FinishRow
                    icon="ri-inbox-line"
                    title="Reviews past today's limit"
                    detail="They're due now. Your limit stays as it is."
                    end={`${cardCount(plan.held.cards)}, ${finishEstimate(plan.held.cards)}`}
                    onClick={() => go(deckStudyHref(plan.held!.deckId, { allReviews: true }))}
                  />
                ) : null}
                {plan.returning ? (
                  <FinishRow
                    icon="ri-time-line"
                    title="Finish what you're learning"
                    detail={`Back ${formatFinishTime(plan.returning.at)} otherwise.`}
                    end={cardCount(plan.returning.cards)}
                    onClick={() =>
                      go(
                        plan.returning!.deckId
                          ? deckStudyHref(plan.returning!.deckId, { learning: true })
                          : reviewHref({ learning: true }),
                      )
                    }
                  />
                ) : null}
                {plan.extras.ahead ? (
                  <FinishRow
                    icon="ri-speed-line"
                    title="Study ahead"
                    detail="Tomorrow's cards. Less useful than waiting."
                    end={`${cardCount(plan.extras.ahead.cards)}, ${finishEstimate(plan.extras.ahead.cards)}`}
                    onClick={() =>
                      go(
                        plan.extras.ahead!.deckId
                          ? deckStudyHref(plan.extras.ahead!.deckId, { ahead: true })
                          : reviewHref({ ahead: true }),
                      )
                    }
                  />
                ) : null}
                <FinishRow
                  icon="ri-add-line"
                  title={session.kind === "deck" && name ? `Add cards to ${name}` : "Make new cards"}
                  detail="From a topic, notes or a file."
                  href={session.kind === "deck" && session.id ? `/create?deck=${session.id}` : "/create"}
                />
              </FinishSection>
            ) : session.kind === "exam" && exam ? (
              <ExamRows exam={exam} name={name} backHref={backHref} left={plan.left} />
            ) : (
              <TodayRows
                decks={sitting.decks}
                left={plan.left}
                state={plan.state}
                returning={plan.returning}
                deckId={session.id}
                held={plan.held}
              />
            )}
            {showExtras && plan.left.length > 0 ? (
              <FinishSection label={session.kind === "deck" ? "Due in other decks" : "Due now"}>
                <LeftRows left={plan.left} limit={2} />
              </FinishSection>
            ) : null}
          </FadeIn>
        </div>
        <div className="dh-study__dock-wrap">
          <div className="dh-study__dock dh-finish__dock">
            <button
              type="button"
              className="dh-study__show"
              onClick={() => guarded(actions.primary.run)}
            >
              <span className="dh-finish__cta">{actions.primary.label}</span>
              {actions.primary.detail ? (
                <span className="dh-finish__cta-detail">{actions.primary.detail}</span>
              ) : null}
              <kbd className="dh-kbd" aria-hidden>Space</kbd>
            </button>
            {actions.secondary ? (
              <button
                type="button"
                className="dh-finish__second"
                onClick={() => guarded(actions.secondary!.run)}
              >
                {actions.secondary.label}
                {actions.secondary.key ? (
                  <kbd className="dh-kbd" aria-hidden>{actions.secondary.key}</kbd>
                ) : null}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function sittingMisses(answers: readonly SittingAnswer<SittingCard>[]) {
  return summarizeAnswers(answers).misses;
}

function daysUntil(iso: string, now = new Date()): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((midnight(at) - midnight(now)) / 86_400_000);
}

function GradeSplit({ first, action }: { first: FinishGradeCounts; action: ReactNode }) {
  return (
    <>
      <div
        className="dh-finish__bar"
        role="img"
        aria-label={STUDY_GRADES.map((grade) => `${grade.label} ${first[grade.id]}`).join(", ")}
      >
        {STUDY_GRADES.filter((grade) => first[grade.id] > 0).map((grade) => (
          <i key={grade.id} style={{ flexGrow: first[grade.id], background: grade.color }} />
        ))}
      </div>
      <div className="dh-finish__legend">
        {STUDY_GRADES.map((grade) => (
          <span key={grade.id}>
            <u style={{ background: grade.color }} aria-hidden />
            {grade.label} <b>{first[grade.id].toLocaleString()}</b>
          </span>
        ))}
        <span className="dh-spacer" />
        {action}
      </div>
    </>
  );
}

function FinishSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dh-finish__section">
      <h2 className="dh-finish__label">
        {label}
        <span className="dh-spacer" />
        {action}
      </h2>
      {children}
    </section>
  );
}

function FinishRow({
  icon,
  mark,
  title,
  detail,
  end,
  due = false,
  href,
  onClick,
}: {
  icon?: string;
  /** A deck's circle: ticked once done. */
  mark?: "done" | "open";
  title: string;
  detail?: string;
  end?: string;
  due?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={`dh-finish__icon${mark ? ` is-${mark}` : ""}`} aria-hidden>
        {mark === "done" ? <i className="ri-check-line" /> : icon ? <i className={icon} /> : null}
      </span>
      <span className="dh-finish__text">
        <b>{title}</b>
        {detail ? <small>{detail}</small> : null}
      </span>
      {end ? <span className={`dh-finish__end${due ? " is-due" : ""}`}>{end}</span> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} replace className="dh-finish__row">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="dh-finish__row" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="dh-finish__row">{body}</div>;
}

function LeftRows({ left, limit }: { left: FinishLeft[]; limit?: number }) {
  const { rows, more } = foldLeft(left, limit);
  return (
    <>
      {rows.map((entry) => (
        <LeftRow key={entry.id} entry={entry} href={leftHref(entry)} />
      ))}
      {more ? (
        <FinishRow
          icon="ri-more-line"
          title={`${more.count} more`}
          detail="See all your decks"
          end={cardCount(more.cards)}
          href="/decks"
        />
      ) : null}
    </>
  );
}

function LeftRow({ entry, href }: { entry: FinishLeft; href: string }) {
  return (
    <FinishRow
      mark="open"
      title={entry.title}
      detail={entry.kind === "exam" ? "Exam" : `About ${finishEstimate(entry.cards)}`}
      end={cardCount(entry.cards)}
      due
      href={href}
    />
  );
}

function LearnRow({
  learn,
  amount,
  onAmount,
  onStart,
}: {
  learn: { title: string; waiting: number };
  amount: number;
  onAmount: (count: number) => void;
  onStart: (count: number) => void;
}) {
  const choices = learnMoreChoices(learn.waiting);
  const chosen = choices.includes(amount) ? amount : (choices[choices.length - 1] ?? 0);
  return (
    <div className="dh-finish__row dh-finish__row--learn">
      <span className="dh-finish__icon" aria-hidden>
        <i className="ri-add-circle-line" />
      </span>
      <span className="dh-finish__text">
        <b>Learn new cards</b>
        <small>
          {learn.waiting.toLocaleString()} waiting in {learn.title}. Just for today.
        </small>
      </span>
      <span className="dh-seg" role="group" aria-label="How many new cards">
        {choices.map((count) => (
          <button key={count} type="button" aria-pressed={count === chosen} onClick={() => onAmount(count)}>
            {count}
          </button>
        ))}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart(chosen)}>
        Start
      </button>
    </div>
  );
}

function TodayRows({
  decks,
  left,
  state,
  returning,
  held,
  deckId,
}: {
  decks: Array<{ id: string; name: string; cards: number; knew: number; ms: number }>;
  left: FinishLeft[];
  state: string;
  returning: { deckId: string | null; cards: number; at: string } | null;
  held: { deckId: string; cards: number; limit: number | null } | null;
  deckId?: string;
}) {
  const stillLeft = new Set(left.map((entry) => entry.id));
  const finished = decks.filter((deck) => !stillLeft.has(deck.id));
  if (finished.length === 0 && left.length === 0 && state !== "limit") return null;
  return (
    <FinishSection
      label="Today"
      action={
        left.length > 1 ? (
          <Link href="/review" replace className="dh-finish__link">
            {left.length === 2 ? "Study both" : `Study all ${left.length}`}
          </Link>
        ) : null
      }
    >
      {finished.map((deck) => {
        const waiting = returning && state === "returning" && deck.id === deckId ? returning : null;
        const later = returning && !waiting && deck.id === returning.deckId ? returning : null;
        const limited = held && state === "limit" && deck.id === held.deckId ? held : null;
        return (
          <FinishRow
            key={deck.id}
            mark={waiting || limited ? undefined : "done"}
            icon={waiting ? "ri-time-line" : limited ? "ri-inbox-line" : undefined}
            title={deck.name}
            detail={
              waiting
                ? `${cardCount(waiting.cards)} still being learned`
                : limited
                  ? `Daily limit of ${(limited.limit ?? 0).toLocaleString()}. Doing the rest now doesn't change it.`
                  : `${deck.knew.toLocaleString()} of ${deck.cards.toLocaleString()} first time${
                      later
                        ? `. ${later.cards.toLocaleString()} back ${formatFinishTime(later.at)}`
                        : ""
                    }`
            }
            end={
              waiting
                ? formatFinishTime(waiting.at).replace(/^at /, "")
                : limited
                  ? `${limited.cards.toLocaleString()} left`
                  : "Done"
            }
          />
        );
      })}
      <LeftRows left={left} />
      {held && state === "limit" ? (
        <FinishRow
          icon="ri-settings-3-line"
          title="Change the limit"
          detail="In this deck's settings."
          href={deckHref(held.deckId, "settings")}
        />
      ) : null}
      {state === "seen-all" && deckId ? (
        <>
          <FinishRow
            icon="ri-calendar-event-line"
            title="Set an exam date"
            detail="Reviews get planned so you're ready on the day."
            href={`/exams/new?deck=${deckId}`}
          />
          <FinishRow
            icon="ri-add-line"
            title="Add more cards"
            detail="From your next chapter, notes or a link."
            href={`/create?deck=${deckId}`}
          />
        </>
      ) : null}
    </FinishSection>
  );
}

function ExamRows({
  exam,
  name,
  backHref,
  left,
}: {
  exam: FinishExamInfo;
  name: string;
  backHref: string;
  left: FinishLeft[];
}) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const rose = Math.round(exam.recallNow * 100) > Math.round(exam.recallStart * 100);
  return (
    <FinishSection label={name}>
      <FinishRow
        icon="ri-line-chart-line"
        title="If it were today"
        detail={`${rose ? `Up from ${percent(exam.recallStart)}. ` : ""}Target ${percent(exam.target)}.`}
        end={percent(exam.recallNow)}
      />
      {exam.skipped > 0 ? (
        <FinishRow
          icon="ri-time-line"
          title={`${cardCount(exam.skipped)} left out`}
          detail="Today's study time for this exam is used up. Change it in exam settings."
          href={backHref}
        />
      ) : null}
      <LeftRows left={left} />
    </FinishSection>
  );
}
