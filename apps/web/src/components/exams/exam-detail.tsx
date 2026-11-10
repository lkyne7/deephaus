"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { ExamDeckBreakdownDto, ExamDetailDto, ExamSummaryDto } from "@deephaus/shared";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { ExamCurve } from "./exam-curve";
import { ExamForm } from "./exam-form";
import {
  cardsLabel,
  curveChoices,
  formatExamLong,
  isCramExam,
  nextSessionLabel,
  percentLabel,
  recallPercent,
  stageLabel,
  studyNowLabel,
  timeLeftLabel,
  trackSummary,
} from "./exam-helpers";
import { ExamPlanCalendar } from "./exam-plan-calendar";
import { ExamReminderPrompt } from "./exam-reminder-prompt";
import { ExamDetailSkeleton } from "./exam-skeletons";
import { deleteExam, runExamAction, updateExam, useExamDetail } from "./use-exams";
import "./exams.css";

type Busy = "archive" | "unarchive" | "suspend_cards" | "delete" | "cap" | "score";
type Confirm = "archive" | "delete" | "suspend_cards";

export function ExamDetail({ examId }: { examId: string }) {
  const router = useRouter();
  const { data, error, isLoading, mutate: reload } = useExamDetail(examId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Deleting empties the cache before the list takes over; keep the page quiet meanwhile.
  const [leaving, setLeaving] = useState(false);

  async function run(kind: Busy, work: () => Promise<unknown>) {
    setBusy(kind);
    setActionError(null);
    try {
      await work();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Could not update the exam.");
    } finally {
      setBusy(null);
    }
  }

  if (editing && data) {
    return <ExamForm exam={data.exam} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="dh-page dh-page--narrow">
      {leaving || (isLoading && !data) ? (
        <ExamDetailSkeleton />
      ) : !data ? (
        <div className="dh-empty">
          <h2>Couldn&apos;t load this exam</h2>
          <p>{error instanceof Error ? error.message : "It may have been deleted."}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="dh-crumb">
            <Link href="/exams">Exams</Link>
            <i className="ri-arrow-right-s-line" aria-hidden />
          </div>
          <ExamHeader
            exam={data.exam}
            stage={data.snapshot.stage}
            busy={busy}
            onEdit={() => setEditing(true)}
            onArchive={() => setConfirm("archive")}
            onUnarchive={() => void run("unarchive", () => runExamAction(examId, "unarchive"))}
            onDelete={() => setConfirm("delete")}
          />
          {actionError ? <p className="exam-field-error exam-detail-error" role="alert">{actionError}</p> : null}
          <ExamBody
            detail={data}
            busy={busy}
            onSelectCap={(minutes) =>
              void run("cap", () => updateExam(examId, { daily_minutes_cap: minutes }))
            }
            onSaveScore={(score) => run("score", () => updateExam(examId, { result_score: score }))}
            onArchive={() => void run("archive", () => runExamAction(examId, "archive"))}
            onSuspend={() => setConfirm("suspend_cards")}
          />

          {confirm === "archive" ? (
            <ConfirmDialog
              title="Archive this exam?"
              body="It moves to Archived on the Exams page and stops asking for study. You can unarchive it at any time."
              action="Archive"
              onClose={() => setConfirm(null)}
              onConfirm={() => void run("archive", () => runExamAction(examId, "archive"))}
            />
          ) : null}
          {confirm === "delete" ? (
            <ConfirmDialog
              title="Delete this exam?"
              body="The exam and its plan are removed. Your cards and their review history stay as they are. This can't be undone."
              action="Delete"
              danger
              onClose={() => setConfirm(null)}
              onConfirm={() =>
                void run("delete", async () => {
                  setLeaving(true);
                  try {
                    await deleteExam(examId);
                  } catch (caught) {
                    setLeaving(false);
                    throw caught;
                  }
                  router.push("/exams");
                })
              }
            />
          ) : null}
          {confirm === "suspend_cards" ? (
            <ConfirmDialog
              title="Let these cards go?"
              body={`${
                data.snapshot.total === 1
                  ? "The 1 card this exam covers is suspended and stops"
                  : `All ${data.snapshot.total.toLocaleString()} cards this exam covers are suspended and stop`
              } coming up for review, and the exam is archived. You can unsuspend cards one at a time in Cards.`}
              action="Let them go"
              onClose={() => setConfirm(null)}
              onConfirm={() => void run("suspend_cards", () => runExamAction(examId, "suspend_cards"))}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function ExamHeader({
  exam,
  stage,
  busy,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  exam: ExamSummaryDto;
  stage: ExamDetailDto["snapshot"]["stage"];
  busy: Busy | null;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const archived = exam.status === "archived";
  const active = exam.status === "active";
  return (
    <>
      <div className="dh-page-head exam-detail-head">
        <h1 className="dh-title">{exam.name}</h1>
        {archived ? (
          <span className="dh-pill dh-pill--outline">Archived</span>
        ) : (
          <span className={active ? "dh-pill dh-pill--accent" : "dh-pill"}>
            {active ? <span className="exam-dot" aria-hidden /> : null}
            {stageLabel(stage)}
          </span>
        )}
        {active && isCramExam(exam.exam_at) ? <span className="dh-pill exam-pill--cram">Cram</span> : null}
        <span className="dh-spacer" />
        {archived ? (
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={onUnarchive}>
            {busy === "unarchive" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Unarchive
          </button>
        ) : null}
        <ExamMenu
          archived={archived}
          disabled={busy !== null}
          onEdit={onEdit}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
        />
      </div>
      <p className="exam-detail-when">
        {[
          formatExamLong(exam.exam_at, { timezone: exam.timezone, hasTime: exam.has_time }),
          active ? timeLeftLabel(exam.exam_at, { timezone: exam.timezone, hasTime: exam.has_time }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </>
  );
}

function ExamMenu({
  archived,
  disabled,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  archived: boolean;
  disabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Array<{ label: string; icon: string; danger?: boolean; run: () => void }> = [
    { label: "Edit", icon: "ri-pencil-line", run: onEdit },
    archived
      ? { label: "Unarchive", icon: "ri-inbox-unarchive-line", run: onUnarchive }
      : { label: "Archive", icon: "ri-archive-line", run: onArchive },
    { label: "Delete", icon: "ri-delete-bin-line", danger: true, run: onDelete },
  ];

  return (
    <div ref={rootRef} className="exam-menu-root">
      <button
        type="button"
        className="exam-icon-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>
      {open ? (
        <div className="exam-menu" role="menu" aria-label="Exam actions">
          {items.map((item) => (
            <div key={item.label}>
              {item.danger ? <div className="dh-menu-sep" /> : null}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "dh-menu-row dh-menu-row--danger" : "dh-menu-row"}
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <i className={item.icon} aria-hidden />
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExamBody({
  detail,
  busy,
  onSelectCap,
  onSaveScore,
  onArchive,
  onSuspend,
}: {
  detail: ExamDetailDto;
  busy: Busy | null;
  onSelectCap: (minutes: number | null) => void;
  onSaveScore: (score: number | null) => Promise<void>;
  onArchive: () => void;
  onSuspend: () => void;
}) {
  const { exam, snapshot, plan, decks } = detail;
  const active = exam.status === "active";
  const over = snapshot.stage === "done";

  if (over) {
    return (
      <>
        <section className="dh-surface exam-hero">
          <div className="exam-hero__numbers">
            <HeroNumber
              value={percentLabel(snapshot.total > 0 ? snapshot.recall_now : null)}
              label="Predicted at the exam"
              title="What your cards' memory predicted you would recall when the exam began"
            />
            <HeroNumber
              value={exam.result_score === null ? "—" : `${Math.round(exam.result_score)}%`}
              label="Your score"
            />
            <div className="exam-hero__copy">
              <div className="exam-hero__headline">This exam is over</div>
              <div className="exam-muted">
                {cardsLabel(snapshot.total)} · target {percentLabel(exam.target_recall)}
              </div>
            </div>
          </div>
        </section>
        {exam.status === "completed" ? (
          <ExamOutcome
            exam={exam}
            busy={busy}
            onSaveScore={onSaveScore}
            onArchive={onArchive}
            onSuspend={onSuspend}
          />
        ) : null}
        <DeckStanding decks={decks} />
      </>
    );
  }

  const track = trackSummary({
    onTrack: plan.on_track,
    projected: plan.projected.recall_at_exam,
    target: exam.target_recall,
    cap: exam.daily_minutes_cap,
    typicalMinutes: plan.needed.typical_minutes,
    peakMinutes: plan.needed.peak_minutes,
    uncapped: plan.curve.find((point) => point.minutes_per_day === null)?.recall_at_exam ?? null,
  });
  const empty = snapshot.total === 0;
  const choices = curveChoices(
    plan.curve,
    exam.daily_minutes_cap,
    plan.projected.recall_at_exam,
    exam.target_recall,
  );

  return (
    <>
      <section className="dh-surface exam-hero">
        <div className="exam-hero__numbers">
          <HeroNumber
            value={percentLabel(empty ? null : snapshot.recall_now)}
            label="If the exam were now"
            title="What you would recall if you sat the exam this minute"
          />
          <HeroNumber
            value={percentLabel(empty ? null : plan.projected.recall_at_exam)}
            label="On track for"
            title="Where you will be at the exam if you follow the plan"
          />
          <div className="exam-hero__copy">
            <div className="exam-hero__headline">
              {empty ? "No cards match this exam yet" : track.headline}
            </div>
            <div className="exam-muted">
              {empty ? "Cards added to what it covers join the exam." : track.detail}
            </div>
            <div className="exam-muted exam-hero__target">Target {percentLabel(exam.target_recall)}</div>
          </div>
        </div>
      </section>

      {active ? (
        <section className="dh-surface exam-session" aria-label="Study session">
          <div className="exam-session__text">
            <div className="exam-session__title">
              {exam.ready_now > 0 ? "Ready to study" : "Done for now"}
            </div>
            <div className="exam-session__meta">
              {exam.ready_now > 0
                ? studyNowLabel(exam)
                : (nextSessionLabel(exam) ?? "Nothing more is needed right now.")}
            </div>
          </div>
          {exam.ready_now > 0 ? (
            <Link href={`/exams/${exam.id}/study`} className="btn btn-primary">
              Study now
            </Link>
          ) : null}
        </section>
      ) : (
        <div className="dh-note exam-archived-note" role="status">
          <i className="ri-archive-line" aria-hidden />
          <span>This exam is archived. Unarchive it to study for it again.</span>
        </div>
      )}

      {active ? <ExamReminderPrompt /> : null}

      <section className="dh-surface exam-stats" aria-label="Where the cards stand">
        <Stat value={snapshot.total.toLocaleString()} label="Cards" />
        <Stat value={snapshot.locked_in.toLocaleString()} label="At target" />
        <Stat value={snapshot.at_risk.toLocaleString()} label="At risk" />
        <Stat value={snapshot.unseen.toLocaleString()} label="Not yet seen" />
      </section>

      {active && !empty ? (
        <>
          <div className="dh-section-label">Daily time and score</div>
          <section className="dh-surface exam-panel">
            <ExamCurve
              choices={choices}
              target={exam.target_recall}
              onSelect={onSelectCap}
              disabled={busy !== null}
              dimmed={busy === "cap"}
            />
          </section>

          <div className="dh-section-label">Day by day</div>
          <ExamPlanCalendar days={plan.days} examAt={exam.exam_at} timezone={exam.timezone} />
        </>
      ) : null}

      <DeckStanding decks={decks} />
    </>
  );
}

function HeroNumber({ value, label, title }: { value: string; label: string; title?: string }) {
  return (
    <div title={title}>
      <div className="exam-hero-num">{value}</div>
      <div className="exam-muted exam-hero__label">{label}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Per-deck standing, weakest deck first (the order the planner returns). */
function DeckStanding({ decks }: { decks: ExamDeckBreakdownDto[] }) {
  if (decks.length === 0) return null;
  return (
    <>
      <div className="dh-section-label">Where you stand</div>
      <section className="dh-surface exam-decks" role="table" aria-label="Where you stand, by deck">
        <div className="exam-deck exam-deck--head" role="row">
          <span role="columnheader">Deck</span>
          <span role="columnheader">Recall at the exam</span>
          <span role="columnheader">Not yet seen</span>
          <span role="columnheader">At risk</span>
        </div>
        {decks.map((deck) => {
          const recall = recallPercent(deck.recall_at_exam) ?? 0;
          return (
            <div key={deck.project_id} className="exam-deck" role="row">
              <span className="exam-deck__main" role="cell">
                <Link href={`/decks/${deck.project_id}`} className="exam-deck__name">
                  {deck.name ?? "Untitled deck"}
                </Link>
                <span className="exam-deck__sub">{cardsLabel(deck.total)}</span>
              </span>
              <span className="exam-deck__recall" role="cell">
                <span className="dh-meter" aria-hidden>
                  <span style={{ width: `${recall}%` }} />
                </span>
                <b>{recall}%</b>
              </span>
              <span className="exam-deck__count" role="cell">{deck.unseen.toLocaleString()}</span>
              <span className="exam-deck__count" role="cell">{deck.at_risk.toLocaleString()}</span>
            </div>
          );
        })}
      </section>
    </>
  );
}

function ExamOutcome({
  exam,
  busy,
  onSaveScore,
  onArchive,
  onSuspend,
}: {
  exam: ExamSummaryDto;
  busy: Busy | null;
  onSaveScore: (score: number | null) => Promise<void>;
  onArchive: () => void;
  onSuspend: () => void;
}) {
  const inputId = useId();
  const saved = exam.result_score === null ? "" : String(Math.round(exam.result_score));
  const [score, setScore] = useState(saved);
  const [invalid, setInvalid] = useState(false);

  function save() {
    const trimmed = score.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && !(Number.isFinite(value) && value >= 0 && value <= 100)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void onSaveScore(value);
  }

  return (
    <section className="dh-surface exam-outcome" aria-label="After the exam">
      <h2>How did it go?</h2>
      <div className="exam-outcome__score">
        <label htmlFor={inputId}>Your score, 0 to 100</label>
        <input
          id={inputId}
          className="input"
          type="text"
          inputMode="numeric"
          value={score}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "" || /^\d{1,3}$/.test(next)) setScore(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null || score.trim() === saved}
          onClick={save}
        >
          {busy === "score" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
          Save
        </button>
      </div>
      {invalid ? (
        <p className="exam-field-error" role="alert">Enter a score from 0 to 100.</p>
      ) : (
        <p className="exam-field-hint">
          Your score is kept with the exam, next to what your cards predicted.
        </p>
      )}

      <div className="exam-outcome__choices">
        <div className="exam-choice">
          <h3>Keep studying these cards</h3>
          <p>They stay on their long-term schedule. Archive the exam to move it out of the way.</p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={onArchive}>
            {busy === "archive" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Archive exam
          </button>
        </div>
        <div className="exam-choice">
          <h3>Let these cards go</h3>
          <p>Every card this exam covers is suspended, and the exam is archived.</p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={onSuspend}>
            {busy === "suspend_cards" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Let them go
          </button>
        </div>
      </div>
    </section>
  );
}

function ConfirmDialog({
  title,
  body,
  action,
  danger = false,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatedModal title={title} onClose={onClose} maxWidth={420} closeOnEscape>
      <p className="exam-dialog-copy">{body}</p>
      <div className="exam-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {action}
        </button>
      </div>
    </AnimatedModal>
  );
}
