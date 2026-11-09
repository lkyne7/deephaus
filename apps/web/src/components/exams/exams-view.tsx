"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExamSummaryDto } from "@deephaus/shared";
import {
  atTargetLabel,
  cardsLabel,
  formatExamLong,
  formatExamShort,
  groupExams,
  isCramExam,
  nextSessionLabel,
  percentLabel,
  recallPercent,
  studyNowLabel,
  timeLeftLabel,
} from "./exam-helpers";
import { ExamListSkeleton } from "./exam-skeletons";
import { useExamList } from "./use-exams";
import "./exams.css";

export function ExamsView() {
  const { data, error, isLoading, mutate: reload } = useExamList();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const exams = data?.exams;
  const groups = useMemo(() => groupExams(exams ?? []), [exams]);

  return (
    <div className="dh-page">
      <div className="dh-page-head">
        <h1 className="dh-title">Exams</h1>
        <span className="dh-spacer" />
        {exams && exams.length > 0 ? (
          <Link href="/exams/new" className="btn btn-primary">
            <i className="ri-add-line" aria-hidden />
            Add exam
          </Link>
        ) : null}
      </div>

      {isLoading && !exams ? (
        <ExamListSkeleton />
      ) : !exams ? (
        <div className="dh-empty">
          <h2>Couldn&apos;t load your exams</h2>
          <p>{error instanceof Error ? error.message : "Something went wrong."}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : exams.length === 0 ? (
        <div className="dh-empty">
          <h2>No exams yet</h2>
          <p>Give an exam a date and the cards it covers, and see what to study each day until then.</p>
          <Link href="/exams/new" className="btn btn-primary btn-sm">
            Add an exam
          </Link>
        </div>
      ) : (
        <div className="exam-main">
          <div className="dh-section-label">Upcoming</div>
          {groups.active.length > 0 ? (
            <section className="dh-surface">
              {groups.active.map((exam) => (
                <ActiveRow key={exam.id} exam={exam} />
              ))}
            </section>
          ) : (
            <p className="exam-none">No upcoming exams.</p>
          )}

          {groups.completed.length > 0 ? (
            <>
              <div className="dh-section-label">Completed</div>
              <section className="dh-surface">
                {groups.completed.map((exam) => (
                  <FinishedRow key={exam.id} exam={exam} />
                ))}
              </section>
            </>
          ) : null}

          {groups.archived.length > 0 ? (
            <>
              <div className="dh-section-label">
                Archived
                <span className="dh-spacer" />
                <button
                  type="button"
                  className="exam-disclosure"
                  aria-expanded={archivedOpen}
                  onClick={() => setArchivedOpen((open) => !open)}
                >
                  {archivedOpen ? "Hide" : `Show ${groups.archived.length}`}
                  <i className={archivedOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden />
                </button>
              </div>
              {archivedOpen ? (
                <section className="dh-surface">
                  {groups.archived.map((exam) => (
                    <FinishedRow key={exam.id} exam={exam} />
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ActiveRow({ exam }: { exam: ExamSummaryDto }) {
  const when = { timezone: exam.timezone, hasTime: exam.has_time };
  const empty = exam.snapshot.total === 0;
  const recall = empty ? null : recallPercent(exam.snapshot.recall_now);
  const next = nextSessionLabel(exam);

  return (
    <div className="exam-row">
      <div className="exam-row__main">
        <div className="exam-row__title">
          <Link href={`/exams/${exam.id}`} className="exam-row__name">
            {exam.name}
          </Link>
          {isCramExam(exam.exam_at) ? <span className="dh-pill exam-pill--cram">Cram</span> : null}
        </div>
        <div className="exam-row__sub">
          {timeLeftLabel(exam.exam_at, when)} · {formatExamLong(exam.exam_at, when)}
        </div>
      </div>
      <div className="exam-row__standing" title="What you would recall if you sat the exam this minute">
        <div className="exam-row__readiness">
          <span>If the exam were now</span>
          <b>{recall === null ? "—" : `${recall}%`}</b>
        </div>
        <div className="dh-meter">
          <span style={{ width: `${recall ?? 0}%` }} />
        </div>
        <div className="exam-row__sub">{empty ? "No cards yet" : atTargetLabel(exam.snapshot)}</div>
      </div>
      <span className="exam-row__action">
        {exam.ready_now > 0 ? (
          <Link href={`/exams/${exam.id}/study`} className="btn btn-primary btn-sm">
            Study · {studyNowLabel(exam)}
          </Link>
        ) : (
          <span className="exam-row__done">
            <b>Done for now</b>
            {next ? <span>{next}</span> : null}
          </span>
        )}
      </span>
    </div>
  );
}

function FinishedRow({ exam }: { exam: ExamSummaryDto }) {
  return (
    <div className="exam-row exam-row--finished">
      <div className="exam-row__main">
        <div className="exam-row__title">
          <Link href={`/exams/${exam.id}`} className="exam-row__name">
            {exam.name}
          </Link>
        </div>
        <div className="exam-row__sub">
          {formatExamShort(exam.exam_at, { timezone: exam.timezone, hasTime: exam.has_time })} ·{" "}
          {cardsLabel(exam.snapshot.total)} · target {percentLabel(exam.target_recall)}
        </div>
      </div>
      <span className="exam-row__result">
        {exam.result_score !== null ? (
          <>
            <span>Your score</span>
            <b>{Math.round(exam.result_score)}%</b>
          </>
        ) : exam.status === "completed" ? (
          <span>How did it go?</span>
        ) : null}
      </span>
    </div>
  );
}
