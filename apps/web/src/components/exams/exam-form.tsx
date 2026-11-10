"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EXAM_DAILY_MINUTES_MAX,
  EXAM_DEFAULT_TARGET,
  EXAM_TARGET_MAX,
  EXAM_TARGET_MIN,
  type ExamInsightDto,
  type ExamSelectorOptions,
  type ExamSummaryDto,
  type PreviewExamBody,
  type UpdateExamBody,
} from "@deephaus/shared";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { CardPickerSkeleton } from "@/components/ui/skeleton-patterns";
import { ExamCurve } from "./exam-curve";
import {
  browserTimeZone,
  cardsLabel,
  curveChoices,
  examAtIso,
  examLocalFields,
  formatStudyWindow,
  MAX_STUDY_WINDOWS,
  minutesLabel,
  parseDailyCap,
  percentLabel,
  STUDY_WINDOW_PRESETS,
  studyWindowFromTime,
  toggleStudyWindow,
  trackSummary,
} from "./exam-helpers";
import { createExam, updateExam, useExamOptions, useExamPreview } from "./use-exams";
import "./exams.css";

type OptionGroup = "decks" | "sources" | "tags";
type SelectedOptions = Record<OptionGroup, Set<string>>;
type PickerItem = { id: string; title: string; sub: string | null; count: number };
type PickerItems = Record<OptionGroup, PickerItem[]>;

const GROUPS: Array<{ id: OptionGroup; label: string; icon: string }> = [
  { id: "decks", label: "Decks", icon: "ri-folder-3-line" },
  { id: "sources", label: "Sources", icon: "ri-file-text-line" },
  { id: "tags", label: "Tags", icon: "ri-price-tag-3-line" },
];

const NO_ITEMS: PickerItems = { decks: [], sources: [], tags: [] };
const TARGET_MIN = Math.round(EXAM_TARGET_MIN * 100);
const TARGET_MAX = Math.round(EXAM_TARGET_MAX * 100);
const DEFAULT_CAP = 30;

function pickerItems(payload: ExamSelectorOptions | undefined): PickerItems {
  const options = payload?.options;
  if (!options) return NO_ITEMS;
  return {
    decks: options.decks.map((deck) => ({
      id: deck.id,
      title: deck.name || "Untitled deck",
      sub: null,
      count: deck.card_count,
    })),
    sources: options.sources.map((source) => ({
      id: source.id,
      title: source.name || "Untitled source",
      sub: source.deck_name || (source.type ? source.type.replaceAll("-", " ") : null),
      count: source.card_count,
    })),
    tags: options.tags.map((tag) => ({ id: tag.tag, title: tag.tag, sub: null, count: tag.count })),
  };
}

/** The exam's own selection, or for a new exam the deck it was started from. */
function selectionOf(exam: ExamSummaryDto | undefined, deckId?: string): SelectedOptions {
  return {
    decks: new Set(exam?.selection_spec.deck_ids ?? (deckId ? [deckId] : [])),
    sources: new Set(exam?.selection_spec.source_ids ?? []),
    tags: new Set(exam?.selection_spec.tags ?? []),
  };
}

/** Local calendar date as YYYY-MM-DD (the UTC date can already be tomorrow in the evening). */
function localDateString(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function inAWeek(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return localDateString(date);
}

function pickedDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

function rangeFill(value: number, max: number) {
  return { "--exam-fill": `${(value / max) * 100}%` } as React.CSSProperties;
}

/**
 * The exam form. Without `exam` it adds one and opens it; with `exam` it
 * edits that exam in place and reports back through `onDone`.
 */
export function ExamForm({
  exam,
  onDone,
  deckId,
}: {
  exam?: ExamSummaryDto;
  onDone?: () => void;
  /** For a new exam: a deck to start with, from "Add an exam" on that deck. */
  deckId?: string;
}) {
  const router = useRouter();
  const editing = Boolean(exam);
  const { data: optionsPayload, error: optionsError, isLoading: optionsLoading, mutate: reloadOptions } =
    useExamOptions();
  const items = useMemo(() => pickerItems(optionsPayload), [optionsPayload]);

  // An exam made elsewhere keeps the day its student picked; a UTC one was
  // never given a zone, so it reads in this browser's time like a new exam.
  const [timezone, setTimezone] = useState(exam && exam.timezone !== "UTC" ? exam.timezone : "UTC");
  useEffect(() => {
    if (!exam || exam.timezone === "UTC") setTimezone(browserTimeZone());
  }, [exam]);

  const initial = useMemo(
    () => (exam ? examLocalFields(exam.exam_at, timezone) : null),
    [exam, timezone],
  );
  const [name, setName] = useState(exam?.name ?? "");
  const [examDate, setExamDate] = useState<string | null>(null);
  const [hasTime, setHasTime] = useState(exam?.has_time ?? false);
  const [examTime, setExamTime] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedOptions>(() => selectionOf(exam, deckId));
  const [target, setTarget] = useState(
    Math.round((exam?.target_recall ?? EXAM_DEFAULT_TARGET) * 100),
  );
  const [cap, setCap] = useState<number | null>(exam?.daily_minutes_cap ?? null);
  const [capText, setCapText] = useState(String(exam?.daily_minutes_cap ?? DEFAULT_CAP));
  const [windows, setWindows] = useState<number[]>(exam?.study_windows ?? []);
  const [customTime, setCustomTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Until the student touches a field it follows the exam (or the default).
  const [defaultDate] = useState(inAWeek);
  const dateValue = examDate ?? initial?.date ?? defaultDate;
  const timeValue = examTime ?? (exam?.has_time ? initial?.time : null) ?? "09:00";
  const whenChanged =
    !exam || examDate !== null || examTime !== null || hasTime !== exam.has_time;

  const selection = useMemo(
    () => ({
      deck_ids: [...selected.decks].sort(),
      source_ids: [...selected.sources].sort(),
      tags: [...selected.tags].sort(),
    }),
    [selected],
  );
  const selectedCount = selection.deck_ids.length + selection.source_ids.length + selection.tags.length;
  const selectionChanged =
    !exam ||
    !sameMembers(selection.deck_ids, exam.selection_spec.deck_ids) ||
    !sameMembers(selection.source_ids, exam.selection_spec.source_ids) ||
    !sameMembers(selection.tags, exam.selection_spec.tags);

  const examAt = useMemo(
    () =>
      whenChanged
        ? dateValue
          ? examAtIso(dateValue, hasTime ? timeValue : null, timezone)
          : null
        : (exam?.exam_at ?? null),
    [dateValue, exam, hasTime, timeValue, timezone, whenChanged],
  );
  const passed = examAt !== null && Date.parse(examAt) <= Date.now();
  // A finished exam keeps its date, so only a date the student changed is checked.
  const dateError = whenChanged && (examAt === null || passed);

  const previewBody = useMemo<PreviewExamBody | null>(
    () =>
      examAt && !passed && selectedCount > 0
        ? {
            exam_at: examAt,
            timezone,
            target_recall: target / 100,
            daily_minutes_cap: cap,
            ...selection,
          }
        : null,
    [cap, examAt, passed, selectedCount, selection, target, timezone],
  );
  const { preview, updating, error: previewError } = useExamPreview(previewBody);

  const missing =
    selectedCount === 0
      ? "Pick what the exam covers."
      : !name.trim()
        ? "Name the exam."
        : dateError
          ? "Pick a date in the future."
          : null;

  function chooseCap(next: number | null) {
    setCap(next);
    if (next !== null) setCapText(String(next));
  }

  function toggleOption(group: OptionGroup, id: string) {
    setSelected((current) => {
      const next = new Set(current[group]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [group]: next };
    });
  }

  function addCustomTime() {
    const minutes = studyWindowFromTime(customTime);
    if (minutes === null) return;
    setWindows((current) => (current.includes(minutes) ? current : toggleStudyWindow(current, minutes)));
    setCustomTime("");
  }

  async function submit() {
    if (missing || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!exam) {
        if (!examAt) throw new Error("Pick a date in the future.");
        const detail = await createExam({
          name: name.trim(),
          exam_at: examAt,
          timezone,
          has_time: hasTime,
          target_recall: target / 100,
          daily_minutes_cap: cap,
          study_windows: windows,
          ...selection,
        });
        posthog.capture("exam_created", { exam_id: detail.exam.id });
        // Stays busy until the exam's page takes over.
        router.push(`/exams/${detail.exam.id}`);
        return;
      }
      // Only what changed is sent, so an untouched date or selection stays exactly as stored.
      const patch: UpdateExamBody = {};
      if (name.trim() !== exam.name) patch.name = name.trim();
      if (whenChanged && examAt) {
        patch.exam_at = examAt;
        patch.timezone = timezone;
        patch.has_time = hasTime;
      }
      if (target !== Math.round(exam.target_recall * 100)) patch.target_recall = target / 100;
      if (cap !== exam.daily_minutes_cap) patch.daily_minutes_cap = cap;
      if (windows.join() !== exam.study_windows.join()) patch.study_windows = windows;
      if (selectionChanged) Object.assign(patch, selection);
      if (Object.keys(patch).length > 0) await updateExam(exam.id, patch);
      setSubmitting(false);
      onDone?.();
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Could not save the exam.");
      setSubmitting(false);
    }
  }

  const dateLabel = pickedDate(dateValue)?.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const customWindows = windows.filter(
    (minutes) => !STUDY_WINDOW_PRESETS.some((preset) => preset.minutes === minutes),
  );
  const windowsFull = windows.length >= MAX_STUDY_WINDOWS;

  return (
    <div className="exam-form-layout">
      <div>
        <div className="dh-crumb">
          <Link href="/exams">Exams</Link>
          <i className="ri-arrow-right-s-line" aria-hidden />
          {exam ? (
            <>
              <button type="button" className="exam-crumb-btn" onClick={() => onDone?.()}>
                {exam.name}
              </button>
              <i className="ri-arrow-right-s-line" aria-hidden />
            </>
          ) : null}
        </div>
        <h1 className="dh-title exam-form-title">{editing ? "Edit exam" : "Add an exam"}</h1>
        <input
          className="input exam-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="Biology midterm"
          aria-label="Exam name"
          autoFocus={!editing}
        />

        <section className="exam-fgroup" aria-label="What it covers">
          <h2>What it covers</h2>
          <ContentPicker
            items={items}
            selected={selected}
            selectedCount={selectedCount}
            loading={optionsLoading}
            error={optionsError ? "Your decks, sources and tags did not load." : null}
            onRetry={() => void reloadOptions()}
            onToggle={toggleOption}
            onClear={() => setSelected(selectionOf(undefined))}
          />
        </section>

        <section className="exam-fgroup" aria-label="When is it?">
          <h2>When is it?</h2>
          <div className="exam-grid2">
            <div className="field">
              <label className="field-label" htmlFor="exam-date">Date</label>
              <div className="input exam-date">
                <i className="ri-calendar-line" aria-hidden />
                <span>{dateLabel ?? "Pick a date"}</span>
                <input
                  id="exam-date"
                  type="date"
                  min={localDateString(new Date())}
                  value={dateValue}
                  onChange={(event) => setExamDate(event.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Time (optional)</span>
              <div className="exam-time-row exam-time-row--field">
                <button
                  type="button"
                  className="dh-toggle"
                  role="switch"
                  aria-checked={hasTime}
                  aria-label="Set a start time"
                  onClick={() => setHasTime((value) => !value)}
                />
                {hasTime ? (
                  <input
                    className="input exam-time-input"
                    type="time"
                    aria-label="Exam start time"
                    value={timeValue}
                    onChange={(event) => setExamTime(event.target.value)}
                  />
                ) : (
                  <span>No time set</span>
                )}
              </div>
            </div>
          </div>
          <p className="exam-field-hint">
            {hasTime
              ? "The plan runs up to this time."
              : "Without a time the plan finishes by 9:00 AM that day, in time for a morning exam."}
            {timezone !== browserTimeZone() && timezone !== "UTC"
              ? ` Times are in ${timezone.replaceAll("_", " ")}.`
              : ""}
          </p>
          {dateError ? (
            <p className="exam-field-error" role="alert">Pick a date in the future.</p>
          ) : null}
        </section>

        <section className="exam-fgroup" aria-label="Target">
          <h2>How much do you want to remember?</h2>
          <div className="exam-range-head">
            <label htmlFor="exam-target">Target recall</label>
            <b>{target}%</b>
          </div>
          <input
            id="exam-target"
            className="exam-range"
            style={rangeFill(target - TARGET_MIN, TARGET_MAX - TARGET_MIN)}
            type="range"
            min={TARGET_MIN}
            max={TARGET_MAX}
            step={1}
            value={target}
            aria-valuetext={`${target}%`}
            onChange={(event) => setTarget(Number(event.target.value))}
          />
          <p className="exam-field-hint">
            The share of these cards you want to recall on the day. A higher target takes more time.
          </p>
        </section>

        <section className="exam-fgroup" aria-label="Daily time">
          <h2>Daily time</h2>
          <div className="exam-cap-row">
            <div className="dh-seg" role="group" aria-label="Daily time limit">
              <button type="button" aria-pressed={cap === null} onClick={() => chooseCap(null)}>
                No limit
              </button>
              <button
                type="button"
                aria-pressed={cap !== null}
                onClick={() => chooseCap(parseDailyCap(capText) ?? DEFAULT_CAP)}
              >
                Set a limit
              </button>
            </div>
            {cap !== null ? (
              <span className="exam-minutes">
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Daily limit in minutes"
                  value={capText}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next !== "" && !/^\d{1,3}$/.test(next)) return;
                    setCapText(next);
                    const parsed = parseDailyCap(next);
                    if (parsed !== null) setCap(parsed);
                  }}
                  onBlur={() => setCapText(String(cap))}
                />
                min a day
              </span>
            ) : null}
          </div>
          <p className="exam-field-hint">
            {cap === null
              ? "Each day takes as long as the plan asks for."
              : `Sessions stop at this limit (up to ${EXAM_DAILY_MINUTES_MAX} minutes). The preview shows what it costs.`}
          </p>
        </section>

        <section className="exam-fgroup" aria-label="Preferred study times">
          <h2>
            Preferred study times <span className="exam-optional">Optional</span>
          </h2>
          <div className="exam-cover">
            {STUDY_WINDOW_PRESETS.map((preset) => {
              const on = windows.includes(preset.minutes);
              return (
                <button
                  key={preset.minutes}
                  type="button"
                  className="dh-filter exam-add"
                  aria-pressed={on}
                  disabled={!on && windowsFull}
                  onClick={() => setWindows((current) => toggleStudyWindow(current, preset.minutes))}
                >
                  {preset.label} · {formatStudyWindow(preset.minutes)}
                </button>
              );
            })}
            {customWindows.map((minutes) => {
              const label = formatStudyWindow(minutes);
              return (
                <span key={minutes} className="dh-pill exam-chip">
                  <i className="ri-time-line" aria-hidden />
                  <span className="exam-chip__label">{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => setWindows((current) => toggleStudyWindow(current, minutes))}
                  >
                    <i className="ri-close-line" aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
          {windowsFull ? null : (
            <div className="exam-time-row">
              <label htmlFor="exam-custom-time">Another time</label>
              <input
                id="exam-custom-time"
                className="input exam-time-input"
                type="time"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={studyWindowFromTime(customTime) === null}
                onClick={addCustomTime}
              >
                Add
              </button>
            </div>
          )}
          <p className="exam-field-hint">Up to three times of day you plan to study.</p>
        </section>
      </div>

      <aside className="exam-form-aside">
        <PlanPreview
          preview={preview}
          updating={updating}
          error={submitError ?? previewError}
          target={target / 100}
          cap={cap}
          hasSelection={selectedCount > 0}
          passed={passed}
          missing={missing}
          submitting={submitting}
          submitLabel={editing ? "Save changes" : "Add exam"}
          onSelectCap={chooseCap}
          onSubmit={() => void submit()}
          onCancel={editing ? () => onDone?.() : undefined}
        />
      </aside>
    </div>
  );
}

function ContentPicker({
  items,
  selected,
  selectedCount,
  loading,
  error,
  onRetry,
  onToggle,
  onClear,
}: {
  items: PickerItems;
  selected: SelectedOptions;
  selectedCount: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onToggle: (group: OptionGroup, id: string) => void;
  onClear: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<OptionGroup>("decks");
  const [query, setQuery] = useState("");

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

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const values = items[activeGroup];
    if (!normalizedQuery) return values;
    return values.filter((item) =>
      [item.title, item.sub].some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }, [activeGroup, items, query]);

  const chips = GROUPS.flatMap((group) =>
    [...selected[group.id]].map((id) => {
      const item = items[group.id].find((candidate) => candidate.id === id);
      // Tags are their own names; a deck or source that has gone has none to show.
      const title = item?.title ?? (group.id === "tags" ? id : loading ? "Loading…" : "No longer available");
      return { group, id, title };
    }),
  );
  const activeLabel = activeGroup.toLowerCase();

  return (
    <div ref={rootRef} className="exam-cover">
      {chips.map(({ group, id, title }) => (
        <span key={`${group.id}:${id}`} className="dh-pill exam-chip">
          <i className={group.icon} aria-hidden />
          <span className="exam-chip__label">{title}</span>
          <button type="button" aria-label={`Remove ${title}`} onClick={() => onToggle(group.id, id)}>
            <i className="ri-close-line" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="dh-filter exam-add"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-add-line" aria-hidden />
        Add decks, sources or tags
      </button>

      {open ? (
        <div className="exam-picker" role="dialog" aria-label="Add decks, sources or tags">
          <div className="dh-tabs" role="tablist" aria-label="Content type">
            {GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={activeGroup === group.id}
                onClick={() => {
                  setActiveGroup(group.id);
                  setQuery("");
                }}
              >
                {group.label}
                {selected[group.id].size > 0 ? <span>{selected[group.id].size}</span> : null}
              </button>
            ))}
          </div>
          <UntitledSearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${activeLabel}...`}
            aria-label={`Search ${activeLabel}`}
            wrapperStyle={{ width: "100%" }}
            autoFocus
          />
          {loading ? (
            <div aria-label="Loading your cards">
              <CardPickerSkeleton rows={5} />
            </div>
          ) : error ? (
            <div className="dh-empty exam-picker__state">
              <h2>Couldn&apos;t load your cards</h2>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="dh-empty exam-picker__state">
              <h2>No {activeLabel} found</h2>
              <p>{query ? "Try a different search." : "There's nothing here yet."}</p>
              {!query ? (
                <Link href="/create" className="btn btn-secondary btn-sm">
                  Create a deck first
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="exam-options">
              {visibleItems.map((item) => (
                <label key={item.id} className="exam-option">
                  <input
                    type="checkbox"
                    checked={selected[activeGroup].has(item.id)}
                    onChange={() => onToggle(activeGroup, item.id)}
                  />
                  <span className="exam-option__main">
                    <span className="exam-option__title">{item.title}</span>
                    {item.sub ? <span className="exam-option__sub">{item.sub}</span> : null}
                  </span>
                  <span className="exam-option__count">{cardsLabel(item.count)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="exam-picker__foot">
            <span>{selectedCount} selected</span>
            {selectedCount > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
                Clear all
              </button>
            ) : null}
            <span className="dh-spacer" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlanPreview({
  preview,
  updating,
  error,
  target,
  cap,
  hasSelection,
  passed,
  missing,
  submitting,
  submitLabel,
  onSelectCap,
  onSubmit,
  onCancel,
}: {
  preview: ExamInsightDto | null;
  updating: boolean;
  error: string | null;
  target: number;
  cap: number | null;
  hasSelection: boolean;
  passed: boolean;
  missing: string | null;
  submitting: boolean;
  submitLabel: string;
  onSelectCap: (minutes: number | null) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const plan = preview?.plan ?? null;
  const snapshot = preview?.snapshot ?? null;
  const choices = plan ? curveChoices(plan.curve, cap, plan.projected.recall_at_exam, target) : [];
  const empty = snapshot !== null && snapshot.total === 0;
  const track =
    plan && !empty
      ? trackSummary({
          onTrack: plan.on_track,
          projected: plan.projected.recall_at_exam,
          target,
          cap,
          typicalMinutes: plan.needed.typical_minutes,
          peakMinutes: plan.needed.peak_minutes,
          uncapped: plan.curve.find((point) => point.minutes_per_day === null)?.recall_at_exam ?? null,
        })
      : null;
  const dim = updating ? " is-updating" : "";

  return (
    <section
      className="dh-surface dh-surface--raised exam-preview"
      aria-label="Plan preview"
      aria-busy={updating}
    >
      <div className="exam-muted">On track for</div>
      <div className={`exam-hero-num${dim}`} aria-live="polite">
        {plan && !empty ? percentLabel(plan.projected.recall_at_exam) : "—"}
      </div>
      <div className="exam-muted exam-preview__by">
        {passed
          ? "This exam has passed, so there is no plan to preview"
          : !hasSelection
            ? "Pick what it covers to see a plan"
            : preview
              ? `against your ${percentLabel(target)} target`
              : updating
                ? "Working it out..."
                : "No plan yet"}
      </div>
      <dl className={`exam-kv-list${dim}`}>
        <PreviewValue label="Cards covered" value={snapshot?.total.toLocaleString()} />
        <PreviewValue label="Not yet seen" value={snapshot?.unseen.toLocaleString()} />
        <PreviewValue
          label="If the exam were now"
          value={snapshot && !empty ? percentLabel(snapshot.recall_now) : null}
        />
        <PreviewValue
          label="Time needed"
          value={plan && !empty ? `about ${minutesLabel(plan.needed.typical_minutes)} a day` : null}
        />
        <PreviewValue
          label="Busiest day"
          value={plan && !empty ? minutesLabel(plan.needed.peak_minutes) : null}
        />
      </dl>
      {empty ? (
        <div className="dh-note exam-preview__note" role="status">
          <i className="ri-information-line" aria-hidden />
          <span>No cards match yet. Cards added to what you picked join the exam.</span>
        </div>
      ) : null}
      {choices.length > 0 && !empty ? (
        <>
          <div className="exam-preview__label">Daily time and score</div>
          <ExamCurve choices={choices} target={target} onSelect={onSelectCap} dimmed={updating} />
        </>
      ) : null}
      {track && !track.onTrack ? (
        <div className="dh-note exam-preview__note" role="status">
          <i className="ri-error-warning-line" aria-hidden />
          <span>
            {track.headline}. {track.detail}
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="exam-field-error" role="alert">{error}</p>
      ) : null}
      <div className={`exam-preview__actions${onCancel ? "" : " exam-preview__actions--single"}`}>
        {onCancel ? (
          <button type="button" className="btn btn-ghost" disabled={submitting} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(missing) || submitting}
          onClick={onSubmit}
        >
          {submitting ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
          {submitLabel}
        </button>
      </div>
      {missing && hasSelection ? <p className="exam-preview__missing">{missing}</p> : null}
    </section>
  );
}

function PreviewValue({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="exam-kv">
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}
