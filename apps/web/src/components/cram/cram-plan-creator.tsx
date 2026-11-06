"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { CardPickerSkeleton } from "@/components/ui/skeleton-patterns";
import { apiFetch } from "@/lib/api/fetch";
import {
  useCramPreviewDraft,
  type DraftPreview,
  type DraftSelection,
  type DraftSettings,
} from "./cram-preview-draft";
import {
  averageDailyReviews,
  DAILY_BUDGET_STOPS,
  getErrorMessage,
  nearestBudgetStop,
  normalizeOptions,
  readinessPercent,
  type CramOptions,
  type SelectionOption,
  type TagOption,
} from "./types";
import "./cram.css";

type OptionGroup = "decks" | "sources" | "tags";
type SelectedOptions = Record<OptionGroup, Set<string>>;

const EMPTY_OPTIONS: CramOptions = { decks: [], sources: [], tags: [] };
const GROUPS: Array<{ id: OptionGroup; label: string; icon: string }> = [
  { id: "decks", label: "Decks", icon: "ri-folder-3-line" },
  { id: "sources", label: "Sources", icon: "ri-file-text-line" },
  { id: "tags", label: "Tags", icon: "ri-price-tag-3-line" },
];

function emptySelection(): SelectedOptions {
  return {
    decks: new Set(),
    sources: new Set(),
    tags: new Set(),
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

function todayDate(): string {
  return localDateString(new Date());
}

function tomorrowDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function clampDailyMinutes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(480, Math.max(5, parsed));
}

function pickedDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}

function optionId(option: SelectionOption | TagOption, group: OptionGroup): string {
  return group === "tags" ? (option as TagOption).tag : (option as SelectionOption).id;
}

function optionTitle(option: SelectionOption | TagOption, group: OptionGroup): string {
  if (group === "tags") return (option as TagOption).tag;
  const item = option as SelectionOption;
  return item.name || item.title || item.label || item.front || "Untitled";
}

export function CramPlanCreator() {
  const router = useRouter();
  const [options, setOptions] = useState<CramOptions>(EMPTY_OPTIONS);
  const [selected, setSelected] = useState<SelectedOptions>(emptySelection);
  const [loading, setLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "start" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [deadlineDate, setDeadlineDate] = useState(tomorrowDate);
  const [hasExactTime, setHasExactTime] = useState(false);
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [timezone, setTimezone] = useState("UTC");
  const [retention, setRetention] = useState(0.9);
  const [dailyMinutes, setDailyMinutes] = useState("30");

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setOptionsError(null);
    try {
      const response = await apiFetch("/api/cram-plans/options", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load card options."));
      setOptions(normalizeOptions(payload));
    } catch (caught) {
      setOptionsError(caught instanceof Error ? caught.message : "Could not load card options.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const selectedCount = useMemo(
    () => Object.values(selected).reduce((total, values) => total + values.size, 0),
    [selected],
  );

  const toggleOption = useCallback((group: OptionGroup, id: string) => {
    setSelected((current) => {
      const nextSet = new Set(current[group]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...current, [group]: nextSet };
    });
  }, []);

  const selection = useMemo<DraftSelection>(
    () => ({
      deck_ids: [...selected.decks],
      source_ids: [...selected.sources],
      tags: [...selected.tags],
    }),
    [selected],
  );
  const selectionKey = useMemo(
    () =>
      JSON.stringify([
        [...selection.deck_ids].sort(),
        [...selection.source_ids].sort(),
        [...selection.tags].sort(),
      ]),
    [selection],
  );

  const deadlineAt = useMemo(() => {
    if (!deadlineDate) return null;
    return zonedLocalToIso(deadlineDate, hasExactTime ? deadlineTime : "23:59:59", timezone);
  }, [deadlineDate, deadlineTime, hasExactTime, timezone]);
  const deadlineInPast = deadlineAt !== null && new Date(deadlineAt).getTime() <= Date.now();

  const budget = clampDailyMinutes(dailyMinutes);
  const settings = useMemo<DraftSettings | null>(
    () =>
      deadlineAt && !deadlineInPast
        ? {
            deadline_at: deadlineAt,
            deadline_timezone: timezone,
            deadline_has_time: hasExactTime,
            target_retention: retention,
            daily_minutes: budget,
          }
        : null,
    [budget, deadlineAt, deadlineInPast, hasExactTime, retention, timezone],
  );

  const { preview, updating, error: previewError, commit } = useCramPreviewDraft({
    selection,
    selectionKey,
    settings,
  });

  const missing =
    selectedCount === 0
      ? "Pick what to cover."
      : !name.trim()
        ? "Name your plan."
        : !settings
          ? "Pick a deadline in the future."
          : null;

  async function submit(start: boolean) {
    if (missing) return;
    setSubmitting(start ? "start" : "save");
    setSubmitError(null);
    try {
      const planId = await commit(name.trim(), start);
      posthog.capture("cram_plan_created", { plan_id: planId });
      router.push(`/cram/${planId}`);
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Could not create the cram plan.");
      setSubmitting(null);
    }
  }

  const deadlineLabel = pickedDate(deadlineDate)?.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const retentionPercent = Math.round(retention * 100);

  return (
    <div className="cram-form-layout">
      <div>
        <div className="dh-crumb">
          <Link href="/cram">Cram</Link>
          <i className="ri-arrow-right-s-line" aria-hidden />
        </div>
        <h1 className="dh-title cram-form-title">What are you cramming for?</h1>
        <input
          className="input cram-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="Biology midterm"
          aria-label="Plan name"
          autoFocus
        />

        <section className="cram-fgroup" aria-label="What to cover">
          <h2>What to cover</h2>
          <ContentPicker
            options={options}
            selected={selected}
            selectedCount={selectedCount}
            loading={loading}
            error={optionsError}
            onRetry={() => void loadOptions()}
            onToggle={toggleOption}
            onClear={() => setSelected(emptySelection())}
          />
        </section>

        <section className="cram-fgroup" aria-label="When is it?">
          <h2>When is it?</h2>
          <div className="cram-grid2">
            <div className="field">
              <label className="field-label" htmlFor="cram-deadline">Deadline</label>
              <div className="input cram-date">
                <i className="ri-calendar-line" aria-hidden />
                <span>{deadlineLabel ?? "Pick a date"}</span>
                <input
                  id="cram-deadline"
                  type="date"
                  min={todayDate()}
                  value={deadlineDate}
                  onChange={(event) => setDeadlineDate(event.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="cram-timezone">Timezone</label>
              <select
                id="cram-timezone"
                className="input"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {timezoneOptions(timezone).map((zone) => (
                  <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="cram-time-row">
            <button
              type="button"
              className="dh-toggle"
              role="switch"
              aria-checked={hasExactTime}
              aria-label="Set an exact local time"
              onClick={() => setHasExactTime((value) => !value)}
            />
            <span>Set an exact local time</span>
            {hasExactTime ? (
              <input
                className="input cram-time-input"
                type="time"
                value={deadlineTime}
                onChange={(event) => setDeadlineTime(event.target.value)}
                aria-label="Exact deadline time"
              />
            ) : null}
          </div>
          {deadlineInPast ? (
            <p className="cram-field-error" role="alert">Pick a deadline in the future.</p>
          ) : null}
        </section>

        <section className="cram-fgroup" aria-label="How hard do you want to go?">
          <h2>How hard do you want to go?</h2>
          <div className="cram-grid2">
            <div>
              <div className="cram-range-head">
                <label htmlFor="cram-retention">Target retention</label>
                <b>{retentionPercent}%</b>
              </div>
              <input
                id="cram-retention"
                className="cram-range"
                style={rangeFill(retentionPercent - 70, 27)}
                type="range"
                min={70}
                max={97}
                step={1}
                value={retentionPercent}
                aria-valuetext={`${retentionPercent}%`}
                onChange={(event) => setRetention(Number(event.target.value) / 100)}
              />
              <p className="cram-field-hint">Higher retention needs more frequent reviews.</p>
            </div>
            <div>
              <div className="cram-range-head">
                <label htmlFor="cram-daily-budget">Daily budget</label>
                <span className="cram-minutes">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Daily budget in minutes"
                    style={{ width: `${Math.max(dailyMinutes.length, 1) + 1}ch` }}
                    value={dailyMinutes}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === "" || /^\d{1,3}$/.test(next)) setDailyMinutes(next);
                    }}
                    onBlur={() => setDailyMinutes(String(clampDailyMinutes(dailyMinutes)))}
                  />
                  min
                </span>
              </div>
              <input
                id="cram-daily-budget"
                className="cram-range"
                style={rangeFill(nearestBudgetStop(budget), DAILY_BUDGET_STOPS.length - 1)}
                type="range"
                min={0}
                max={DAILY_BUDGET_STOPS.length - 1}
                step={1}
                value={nearestBudgetStop(budget)}
                aria-valuetext={`${budget} minutes a day`}
                onChange={(event) =>
                  setDailyMinutes(String(DAILY_BUDGET_STOPS[Number(event.target.value)]))
                }
              />
              <p className="cram-field-hint">A soft limit. You can keep going when you reach it.</p>
            </div>
          </div>
        </section>
      </div>

      <aside className="cram-form-aside">
        <ReadinessPreview
          preview={preview}
          updating={updating}
          error={submitError ?? previewError}
          deadlineDate={deadlineDate}
          hasSelection={selectedCount > 0}
          missing={missing}
          submitting={submitting}
          onSubmit={(start) => void submit(start)}
        />
      </aside>
    </div>
  );
}

function rangeFill(value: number, max: number) {
  return { "--cram-fill": `${(value / max) * 100}%` } as React.CSSProperties;
}

function ContentPicker({
  options,
  selected,
  selectedCount,
  loading,
  error,
  onRetry,
  onToggle,
  onClear,
}: {
  options: CramOptions;
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

  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (activeGroup === "tags") {
      const values = options.tags;
      return normalizedQuery
        ? values.filter((option) => option.tag.toLowerCase().includes(normalizedQuery))
        : values;
    }
    const values = options[activeGroup];
    if (!normalizedQuery) return values;
    return values.filter((option) =>
      [option.name, option.title, option.label, option.front, option.deck_name, option.source_name]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [activeGroup, options, query]);

  const chips = GROUPS.flatMap((group) =>
    [...selected[group.id]].map((id) => {
      const option = (options[group.id] as Array<SelectionOption | TagOption>).find(
        (candidate) => optionId(candidate, group.id) === id,
      );
      return { group, id, title: option ? optionTitle(option, group.id) : id };
    }),
  );
  const activeLabel = activeGroup.toLowerCase();

  return (
    <div ref={rootRef} className="cram-cover">
      {chips.map(({ group, id, title }) => (
        <span key={`${group.id}:${id}`} className="dh-pill cram-chip">
          <i className={group.icon} aria-hidden />
          <span className="cram-chip__label">{title}</span>
          <button type="button" aria-label={`Remove ${title}`} onClick={() => onToggle(group.id, id)}>
            <i className="ri-close-line" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="dh-filter cram-add"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-add-line" aria-hidden />
        Add decks, sources or tags
      </button>

      {open ? (
        <div className="cram-picker" role="dialog" aria-label="Add decks, sources or tags">
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
            <div className="dh-empty cram-picker__state">
              <h2>Couldn&apos;t load your cards</h2>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : visibleOptions.length === 0 ? (
            <div className="dh-empty cram-picker__state">
              <h2>No {activeLabel} found</h2>
              <p>{query ? "Try a different search." : "There's nothing here yet."}</p>
              {!query ? (
                <Link href="/create" className="btn btn-secondary btn-sm">
                  Create a deck first
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="cram-options">
              {visibleOptions.map((option) => {
                const id = optionId(option, activeGroup);
                return (
                  <OptionRow
                    key={id}
                    option={option}
                    group={activeGroup}
                    checked={selected[activeGroup].has(id)}
                    onToggle={() => onToggle(activeGroup, id)}
                  />
                );
              })}
            </div>
          )}
          <div className="cram-picker__foot">
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

function OptionRow({
  option,
  group,
  checked,
  onToggle,
}: {
  option: SelectionOption | TagOption;
  group: OptionGroup;
  checked: boolean;
  onToggle: () => void;
}) {
  const isTag = group === "tags";
  const item = isTag ? null : (option as SelectionOption);
  const tag = isTag ? (option as TagOption) : null;
  const subtitle =
    item?.deck_name ||
    item?.source_name ||
    (item?.type ? item.type.replaceAll("-", " ") : null);
  const count = tag?.count ?? item?.card_count ?? item?.count;

  return (
    <label className="cram-option">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="cram-option__main">
        <span className="cram-option__title">{optionTitle(option, group)}</span>
        {subtitle ? <span className="cram-option__sub">{subtitle}</span> : null}
      </span>
      {typeof count === "number" ? (
        <span className="cram-option__count">
          {count.toLocaleString()} {count === 1 ? "card" : "cards"}
        </span>
      ) : null}
    </label>
  );
}

function ReadinessPreview({
  preview,
  updating,
  error,
  deadlineDate,
  hasSelection,
  missing,
  submitting,
  onSubmit,
}: {
  preview: DraftPreview | null;
  updating: boolean;
  error: string | null;
  deadlineDate: string;
  hasSelection: boolean;
  missing: string | null;
  submitting: "save" | "start" | null;
  onSubmit: (start: boolean) => void;
}) {
  const forecast = preview?.forecast ?? null;
  const readiness =
    typeof forecast?.readiness === "number" ? readinessPercent(forecast.readiness) : null;
  const coverage = readinessPercent(forecast?.target_coverage);
  const reviews = averageDailyReviews(forecast);
  const byDate = pickedDate(deadlineDate)?.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const busy = submitting !== null;

  return (
    <section
      className="dh-surface dh-surface--raised cram-preview"
      aria-label="Readiness preview"
      aria-busy={updating}
    >
      <div className="cram-muted">Predicted readiness</div>
      <div className={`cram-hero-num${updating ? " is-updating" : ""}`} aria-live="polite">
        {readiness === null ? "—" : `${readiness}%`}
      </div>
      <div className="cram-muted cram-preview__by">
        {!hasSelection
          ? "Pick what to cover to see a prediction"
          : preview
            ? `by ${byDate ?? "your deadline"} if you keep to the plan`
            : updating
              ? "Working it out..."
              : "No prediction yet"}
      </div>
      <dl className={`cram-kv-list${updating ? " is-updating" : ""}`}>
        <PreviewValue label="Cards" value={preview?.cardCount?.toLocaleString()} />
        <PreviewValue label="Study units" value={preview?.itemCount?.toLocaleString()} />
        <PreviewValue label="Target coverage" value={coverage === null ? null : `${coverage}%`} />
        <PreviewValue
          label="Reviews per day"
          value={reviews === null ? null : `about ${reviews.toLocaleString()}`}
        />
      </dl>
      {forecast?.feasible === false ? (
        <div className="dh-note cram-preview__note" role="status">
          <i className="ri-error-warning-line" aria-hidden />
          <span>
            This budget is unlikely to bring every card to your target by the deadline. Add minutes,
            lower the target, or cover less.
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="cram-field-error" role="alert">{error}</p>
      ) : null}
      <div className="cram-preview__actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={Boolean(missing) || busy}
          onClick={() => onSubmit(false)}
        >
          {submitting === "save" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
          Save draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={Boolean(missing) || busy}
          onClick={() => onSubmit(true)}
        >
          {submitting === "start" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
          Start plan
        </button>
      </div>
      {missing && hasSelection ? <p className="cram-preview__missing">{missing}</p> : null}
    </section>
  );
}

function PreviewValue({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="cram-kv">
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function timezoneOptions(current: string): string[] {
  return Array.from(
    new Set([
      current,
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
    ]),
  );
}

function zonedLocalToIso(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const offsetAt = (timestamp: number) => {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
      );
      const representedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      return representedAsUtc - timestamp;
    };
    let result = utcGuess - offsetAt(utcGuess);
    result = utcGuess - offsetAt(result);
    return new Date(result).toISOString();
  } catch {
    return new Date(utcGuess).toISOString();
  }
}
