"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { CardPickerSkeleton } from "@/components/ui/skeleton-patterns";
import { apiFetch } from "@/lib/api/fetch";
import {
  getErrorMessage,
  isRecord,
  normalizeOptions,
  type CramOptions,
  type SelectionOption,
  type TagOption,
} from "./types";
import "./cram.css";

type OptionGroup = "decks" | "sources" | "tags";
type SelectedOptions = Record<OptionGroup, Set<string>>;

const EMPTY_OPTIONS: CramOptions = { decks: [], sources: [], tags: [] };
const GROUPS: Array<{ id: OptionGroup; label: string; icon: string }> = [
  { id: "decks", label: "Decks", icon: "ri-stack-line" },
  { id: "sources", label: "Sources", icon: "ri-file-text-line" },
  { id: "tags", label: "Tags", icon: "ri-price-tag-3-line" },
];
const CRAM_PLANS_BACK = { href: "/cram", label: "Cram Plans" };

function emptySelection(): SelectedOptions {
  return {
    decks: new Set(),
    sources: new Set(),
    tags: new Set(),
  };
}

function tomorrowDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function clampDailyMinutes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(480, Math.max(5, parsed));
}

export function CramPlanCreator() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [options, setOptions] = useState<CramOptions>(EMPTY_OPTIONS);
  const [selected, setSelected] = useState<SelectedOptions>(emptySelection);
  const [activeGroup, setActiveGroup] = useState<OptionGroup>("decks");
  const activeGroupLabel = (
    GROUPS.find((g) => g.id === activeGroup)?.label ?? activeGroup
  ).toLowerCase();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"preview" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [serverPreview, setServerPreview] = useState<Record<string, unknown> | null>(null);
  const [name, setName] = useState("My Cram Plan");
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
    setError(null);
    try {
      const response = await apiFetch("/api/cram-plans/options", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load card options."));
      setOptions(normalizeOptions(payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load card options.");
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

  const toggleOption = useCallback((group: OptionGroup, id: string) => {
    setSelected((current) => {
      const nextSet = new Set(current[group]);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return { ...current, [group]: nextSet };
    });
  }, []);

  const createPlan = useCallback(
    async (mode: "preview" | "start") => {
      if (selectedCount === 0 || !deadlineDate || !name.trim()) return;
      setSubmitting(mode);
      setError(null);
      try {
        const localTime = hasExactTime ? deadlineTime : "23:59:59";
        const deadlineAt = zonedLocalToIso(deadlineDate, localTime, timezone);
        const body = {
          name: name.trim(),
          deck_ids: [...selected.decks],
          source_ids: [...selected.sources],
          tags: [...selected.tags],
          deadline_at: deadlineAt,
          deadline_timezone: timezone,
          deadline_has_time: hasExactTime,
          target_retention: retention,
          daily_minutes: clampDailyMinutes(dailyMinutes),
        };
        const response = await apiFetch(
          draftId ? `/api/cram-plans/${draftId}` : "/api/cram-plans",
          {
          method: draftId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          },
        );
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(payload, "Could not create the cram plan."));
        const plan = isRecord(payload) && isRecord(payload.plan) ? payload.plan : null;
        const planId = plan && typeof plan.id === "string" ? plan.id : null;
        if (!planId) throw new Error("The plan was created without an id.");
        if (!draftId) posthog.capture("cram_plan_created", { plan_id: planId });
        setDraftId(planId);
        setServerPreview(isRecord(payload) ? payload : null);

        if (mode === "start") {
          const startResponse = await apiFetch(`/api/cram-plans/${planId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          });
          const startPayload: unknown = await startResponse.json().catch(() => null);
          if (!startResponse.ok) {
            throw new Error(getErrorMessage(startPayload, "The plan was created, but could not be started."));
          }
          router.push(`/cram/${planId}/study`);
        } else {
          setStep(3);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not create the cram plan.");
      } finally {
        setSubmitting(null);
      }
    },
    [
      dailyMinutes,
      deadlineDate,
      deadlineTime,
      draftId,
      hasExactTime,
      name,
      retention,
      router,
      selected,
      selectedCount,
      timezone,
    ],
  );

  return (
    <div className="cram-page">
      <PageHeaderSlot title="New Cram Plan" back={CRAM_PLANS_BACK} />
      <div className="cram-page-narrow">
        <div className="cram-panel cram-creator">
          <div className="cram-stepper" aria-label="Create cram plan progress">
            {["Select content", "Deadline & pace", "Preview"].map((label, index) => {
              const number = index + 1;
              return (
                <div
                  key={label}
                  className={`cram-step${step === number ? " is-active" : ""}${step > number ? " is-complete" : ""}`}
                >
                  <span className="cram-step-index">
                    {step > number ? <i className="ri-check-line" aria-hidden /> : number}
                  </span>
                  {label}
                </div>
              );
            })}
          </div>

          <div className="cram-creator-body">
            {step === 1 ? (
              <>
                <h1 className="cram-section-heading">Choose what to cram</h1>
                <p className="cram-section-copy">
                  Combine whole decks, sources, and tags. Cram sessions don&apos;t change
                  your regular review schedule.
                </p>
                <div className="cram-filter-tabs" role="tablist" aria-label="Cram selection type">
                  {GROUPS.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="tab"
                      aria-selected={activeGroup === group.id}
                      className={`cram-filter-tab${activeGroup === group.id ? " is-active" : ""}`}
                      onClick={() => {
                        setActiveGroup(group.id);
                        setQuery("");
                      }}
                    >
                      <i className={group.icon} aria-hidden /> {group.label}
                      {selected[group.id].size > 0 ? ` (${selected[group.id].size})` : ""}
                    </button>
                  ))}
                </div>
                <UntitledSearchInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${activeGroupLabel}...`}
                  aria-label={`Search ${activeGroupLabel}`}
                  wrapperStyle={{ width: "100%" }}
                />
                {loading ? (
                  <div style={{ padding: "6px 2px" }} aria-label="Loading your cards">
                    <CardPickerSkeleton rows={7} />
                  </div>
                ) : error ? (
                  <div className="cram-state" style={{ minHeight: 250 }}>
                    <i className="ri-error-warning-line" aria-hidden />
                    <h2>Couldn&apos;t load card options</h2>
                    <p>{error}</p>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadOptions()}>
                      Try again
                    </button>
                  </div>
                ) : visibleOptions.length === 0 ? (
                  <div className="cram-state" style={{ minHeight: 250 }}>
                    <i className="ri-inbox-2-line" aria-hidden />
                    <h2>No {activeGroupLabel} found</h2>
                    <p>{query ? "Try a different search." : "There are no options in this category yet."}</p>
                    {!query && (
                      <Link href="/create" className="btn btn-secondary btn-sm">
                        <i className="ri-add-line" aria-hidden />
                        Create a deck first
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="cram-options-list">
                    {visibleOptions.map((option) => {
                      const id = activeGroup === "tags" ? (option as TagOption).tag : (option as SelectionOption).id;
                      return (
                        <OptionRow
                          key={id}
                          option={option}
                          group={activeGroup}
                          checked={selected[activeGroup].has(id)}
                          onToggle={() => toggleOption(activeGroup, id)}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="cram-selected-summary">
                  <span>{selectedCount} selection{selectedCount === 1 ? "" : "s"} added</span>
                  {selectedCount > 0 ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelected(emptySelection())}
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <DeadlineStep
                name={name}
                setName={setName}
                deadlineDate={deadlineDate}
                setDeadlineDate={setDeadlineDate}
                hasExactTime={hasExactTime}
                setHasExactTime={setHasExactTime}
                deadlineTime={deadlineTime}
                setDeadlineTime={setDeadlineTime}
                timezone={timezone}
                setTimezone={setTimezone}
                retention={retention}
                setRetention={setRetention}
                dailyMinutes={dailyMinutes}
                setDailyMinutes={setDailyMinutes}
              />
            ) : null}

            {step === 3 ? (
              <PreviewStep
                name={name}
                selected={selected}
                selectedCount={selectedCount}
                deadlineDate={deadlineDate}
                deadlineTime={deadlineTime}
                hasExactTime={hasExactTime}
                timezone={timezone}
                retention={retention}
                dailyMinutes={dailyMinutes}
                preview={serverPreview}
              />
            ) : null}

            {step > 1 && error ? <div className="cram-error">{error}</div> : null}

            <div className="cram-creator-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => (step === 1 ? router.push("/cram") : setStep((current) => current - 1))}
                disabled={submitting !== null}
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              <div>
                {step < 3 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setError(null);
                      if (step === 2) void createPlan("preview");
                      else setStep((current) => current + 1);
                    }}
                    disabled={submitting !== null ||
                      (step === 1 && (selectedCount === 0 || loading || Boolean(error))) ||
                      (step === 2 && (!deadlineDate || !name.trim()))
                    }
                  >
                    {submitting === "preview" ? (
                      <i className="ri-loader-4-line icon-spin" aria-hidden />
                    ) : null}
                    {step === 2 ? "Build preview" : "Continue"}
                    <i className="ri-arrow-right-line" aria-hidden />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => draftId && router.push(`/cram/${draftId}`)}
                      disabled={submitting !== null || !draftId}
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void createPlan("start")}
                      disabled={submitting !== null || !draftId}
                    >
                      {submitting === "start" ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : <i className="ri-play-line" aria-hidden />}
                      Start plan
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
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
  const title =
    tag?.tag ||
    item?.name ||
    item?.title ||
    item?.label ||
    item?.front ||
    "Untitled";
  const subtitle =
    item?.deck_name ||
    item?.source_name ||
    (item?.type ? item.type.replaceAll("-", " ") : null);
  const count = tag?.count ?? item?.card_count ?? item?.count;

  return (
    <label className="cram-option">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="cram-option-main">
        <span className="cram-option-title">{title}</span>
        {subtitle ? <span className="cram-option-subtitle">{subtitle}</span> : null}
      </span>
      {typeof count === "number" ? (
        <span className="cram-option-count">{count.toLocaleString()} cards</span>
      ) : null}
    </label>
  );
}

type DeadlineStepProps = {
  name: string;
  setName: (value: string) => void;
  deadlineDate: string;
  setDeadlineDate: (value: string) => void;
  hasExactTime: boolean;
  setHasExactTime: (value: boolean) => void;
  deadlineTime: string;
  setDeadlineTime: (value: string) => void;
  timezone: string;
  setTimezone: (value: string) => void;
  retention: number;
  setRetention: (value: number) => void;
  dailyMinutes: string;
  setDailyMinutes: (value: string) => void;
};

function DeadlineStep(props: DeadlineStepProps) {
  return (
    <>
      <h1 className="cram-section-heading">Set your deadline and pace</h1>
      <p className="cram-section-copy">
        The plan will prioritize selected cards within this separate daily budget.
      </p>
      <div className="cram-fields">
        <div className="field is-wide">
          <label className="field-label" htmlFor="cram-name">Plan name</label>
          <input
            id="cram-name"
            className="input"
            value={props.name}
            onChange={(event) => props.setName(event.target.value)}
            maxLength={120}
            placeholder="Finals week"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cram-deadline">Deadline</label>
          <input
            id="cram-deadline"
            className="input"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={props.deadlineDate}
            onChange={(event) => props.setDeadlineDate(event.target.value)}
          />
          <label className="cram-check-row">
            <input
              type="checkbox"
              checked={props.hasExactTime}
              onChange={(event) => props.setHasExactTime(event.target.checked)}
            />
            Set an exact local time
          </label>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cram-timezone">Timezone</label>
          <select
            id="cram-timezone"
            className="input"
            value={props.timezone}
            onChange={(event) => props.setTimezone(event.target.value)}
          >
            {timezoneOptions(props.timezone).map((zone) => (
              <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>
            ))}
          </select>
          {props.hasExactTime ? (
            <input
              className="input"
              type="time"
              value={props.deadlineTime}
              onChange={(event) => props.setDeadlineTime(event.target.value)}
              aria-label="Exact deadline time"
            />
          ) : (
            <p className="cram-field-hint">The deadline will be the end of this day.</p>
          )}
        </div>
        <div className="field">
          <label className="field-label cram-range-label" htmlFor="cram-retention">
            <span>Target retention</span>
            <strong>{Math.round(props.retention * 100)}%</strong>
          </label>
          <input
            id="cram-retention"
            className="cram-range"
            type="range"
            min={70}
            max={97}
            step={1}
            value={Math.round(props.retention * 100)}
            onChange={(event) => props.setRetention(Number(event.target.value) / 100)}
          />
          <p className="cram-field-hint">Higher retention needs more frequent reviews.</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="cram-daily-minutes">Daily study budget</label>
          <div className="cram-inline-fields">
            <input
              id="cram-daily-minutes"
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-describedby="cram-daily-minutes-hint"
              value={props.dailyMinutes}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "" || /^\d{1,3}$/.test(next)) {
                  props.setDailyMinutes(next);
                }
              }}
              onBlur={() => {
                props.setDailyMinutes(String(clampDailyMinutes(props.dailyMinutes)));
              }}
            />
            <div className="input" aria-hidden style={{ color: "var(--fg-4)" }}>minutes / day</div>
          </div>
          <p id="cram-daily-minutes-hint" className="cram-field-hint">This is a soft limit; you can continue when it is reached.</p>
        </div>
      </div>
    </>
  );
}

function PreviewStep({
  name,
  selected,
  selectedCount,
  deadlineDate,
  deadlineTime,
  hasExactTime,
  timezone,
  retention,
  dailyMinutes,
  preview,
}: {
  name: string;
  selected: SelectedOptions;
  selectedCount: number;
  deadlineDate: string;
  deadlineTime: string;
  hasExactTime: boolean;
  timezone: string;
  retention: number;
  dailyMinutes: string;
  preview: Record<string, unknown> | null;
}) {
  const plan = preview && isRecord(preview.plan) ? preview.plan : {};
  const forecast = preview && isRecord(preview.forecast) ? preview.forecast : {};
  const readiness =
    finiteNumber(forecast.readiness_score) ??
    finiteNumber(forecast.readiness);
  const targetCoverage = finiteNumber(forecast.target_coverage);
  const cardCount = finiteNumber(plan.card_count);
  const itemCount = finiteNumber(plan.item_count) ?? finiteNumber(forecast.item_count);
  const capacity =
    finiteNumber(forecast.daily_review_capacity) ??
    finiteNumber(forecast.reviews_per_day);
  const feasible = forecast.feasible;

  return (
    <>
      <h1 className="cram-section-heading">Review your cram plan</h1>
      <div className="cram-preview-grid">
        <PreviewValue label="Plan" value={name.trim() || "Untitled cram plan"} />
        <PreviewValue label="Cards" value={cardCount?.toLocaleString() ?? "—"} />
        <PreviewValue label="Study units" value={itemCount?.toLocaleString() ?? "—"} />
        <PreviewValue
          label="Predicted readiness"
          value={readiness == null ? "—" : `${Math.round(readiness * 100)}%`}
        />
        <PreviewValue
          label="Target coverage"
          value={targetCoverage == null ? "—" : `${Math.round(targetCoverage * 100)}%`}
        />
        <PreviewValue
          label="Planned reviews / day"
          value={capacity?.toLocaleString() ?? "—"}
        />
        <PreviewValue label="Deadline" value={`${deadlineDate}${hasExactTime ? ` at ${deadlineTime}` : ""}`} />
        <PreviewValue label="Timezone" value={timezone.replaceAll("_", " ")} />
        <PreviewValue label="Target retention" value={`${Math.round(retention * 100)}%`} />
        <PreviewValue label="Daily budget" value={`${clampDailyMinutes(dailyMinutes)} minutes`} />
      </div>
      {feasible === false ? (
        <div className="notice notice-warning" role="status">
          This budget is unlikely to bring every selected card to the target retention by the deadline.
          Increase the daily minutes, lower the target, or reduce the selection.
        </div>
      ) : null}
      <div className="cram-panel" style={{ padding: 18 }}>
        <h2 className="cram-section-heading" style={{ fontSize: 15 }}>Included filters</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {GROUPS.filter((group) => selected[group.id].size > 0).map((group) => (
            <span key={group.id} className="chip chip-neutral">
              <i className={group.icon} aria-hidden />
              {selected[group.id].size} {group.label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function PreviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="cram-preview-item">
      <span>{label}</span>
      <strong>{value}</strong>
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
