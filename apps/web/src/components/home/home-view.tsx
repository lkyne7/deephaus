"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import useSWR from "swr";
import type { ExamListResponse } from "@deephaus/shared";
import { BrandMark } from "@/components/brand-mark";
import { nearestActiveExam } from "@/components/exams/exam-helpers";
import { HomeComposer } from "@/components/home/home-composer";
import { useSettings } from "@/components/settings/settings-context";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { useReviewHeatmap } from "@/lib/client-cache/hooks/use-review-heatmap";
import { cacheKeys } from "@/lib/client-cache/keys";
import { useAppShellUser } from "@/lib/client-cache/user-context";
import { formatRelative } from "@/lib/fsrs/dashboard-decks";
import { toIsoDateKey } from "@/lib/fsrs/date-utils";
import {
  estimateStudyDuration,
  nextCardsLabel,
  pickContinueDecks,
  pickRecentDecks,
} from "@/lib/fsrs/home-summary";
import type { DashboardStats } from "@/lib/fsrs/stats";
import { timeOfDayGreeting } from "@/lib/user/display-name";
import "./home.css";

const COMPOSER_PLACEHOLDER = "Make new cards: name a topic, paste notes, or add a source…";

const noSubscribe = () => () => undefined;

/** The server doesn't know the user's clock, so it renders no time of day. */
function useLocalHour(): number | null {
  return useSyncExternalStore(
    noSubscribe,
    () => new Date().getHours(),
    () => null,
  );
}

function useExamHref(): string {
  const { data } = useSWR<ExamListResponse>(cacheKeys.exams);
  // While loading, the list: an exam that is running must not be skipped.
  if (!data) return "/exams";
  const nearest = nearestActiveExam(data.exams);
  // The exam that comes first, or the form when none is coming up.
  return nearest ? `/exams/${nearest.id}` : "/exams/new";
}

function Greeting({ children }: { children: ReactNode }) {
  return (
    <h1 className="dh-home__greet dh-eq dh-eq-hover">
      <BrandMark size={40} title={null} className="dh-greet-mark" />
      {children}
    </h1>
  );
}

/** Long deck lists get a filter box. */
const DECK_FILTER_MIN = 8;

type DeckRow = DashboardStats["per_deck"][number];

/** Scopes the Today card to one deck, or back to all of them. Decks with cards due come first. */
function DeckPicker({
  decks,
  selected,
  onSelect,
}: {
  decks: DeckRow[];
  selected: DeckRow | null;
  onSelect: (deckId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const showFilter = decks.length >= DECK_FILTER_MIN;

  const sorted = useMemo(
    () =>
      decks
        .filter((deck) => deck.total > 0)
        .sort((a, b) => b.due - a.due || b.new - a.new || a.name.localeCompare(b.name)),
    [decks],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? sorted.filter((deck) => deck.name.toLowerCase().includes(needle)) : sorted;
  }, [sorted, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (showFilter) filterRef.current?.focus();
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
  }, [open, showFilter]);

  function choose(deckId: string | null) {
    onSelect(deckId);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="dh-home-composer__anchor">
      <button
        type="button"
        className={`dh-home-tool${selected ? " is-selected" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i className="ri-folder-3-line" aria-hidden />
        <span className="dh-home-composer__deck-label">{selected ? selected.name : "Choose a deck"}</span>
        <i className="ri-arrow-down-s-line" aria-hidden />
      </button>
      {open ? (
        <div className="dh-home-composer__menu dh-home-deck-menu" role="menu" aria-label="Choose a deck to review">
          {showFilter ? (
            <label className="dh-home-deck-menu__filter">
              <i className="ri-search-line" aria-hidden />
              <input
                ref={filterRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a deck…"
                aria-label="Find a deck"
              />
            </label>
          ) : null}
          {query.trim() ? null : (
            <>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!selected}
                className="dh-menu-row"
                onClick={() => choose(null)}
              >
                <i className="ri-stack-line" aria-hidden />
                <span className="dh-home-list__name">All decks</span>
                {selected ? null : <i className="ri-check-line dh-home-deck-menu__check" aria-hidden />}
              </button>
              <div className="dh-menu-sep" />
            </>
          )}
          <div className="dh-home-deck-menu__list">
            {visible.map((deck) => {
              const active = deck.deck_id === selected?.deck_id;
              return (
                <button
                  key={deck.deck_id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className="dh-menu-row"
                  onClick={() => choose(deck.deck_id)}
                >
                  <i className="ri-folder-3-line" aria-hidden />
                  <span className="dh-home-list__name">{deck.name}</span>
                  {deck.due > 0 ? (
                    <span className="dh-count dh-count--due">{deck.due} due</span>
                  ) : deck.new > 0 ? (
                    <span className="dh-count">{deck.new} new</span>
                  ) : null}
                  {active ? <i className="ri-check-line dh-home-deck-menu__check" aria-hidden /> : null}
                </button>
              );
            })}
            {visible.length === 0 ? (
              <p className="dh-home-deck-menu__empty">
                {query.trim() ? `No decks match “${query.trim()}”.` : "No decks with cards yet."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TodayCard({ stats }: { stats: DashboardStats }) {
  const router = useRouter();
  const examHref = useExamHref();
  const [deckId, setDeckId] = useState<string | null>(null);
  const deck = deckId ? (stats.per_deck.find((row) => row.deck_id === deckId) ?? null) : null;

  const due = deck ? deck.due : stats.due_now;
  const fresh = deck ? deck.new : stats.new_today_remaining;
  // Per-deck stats don't count today's reviews, so a chosen deck shows due and new only.
  const reviewed = deck ? 0 : stats.reviewed_today;
  const ready = due + fresh;
  const reviewHref = deck ? `/decks/${deck.deck_id}/study` : "/review";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target !== document.body) return;
      event.preventDefault();
      router.push(reviewHref);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, reviewHref]);

  const summary = [
    `${stats.streak}-day streak`,
    ...(stats.retention_pct !== null ? [`${Math.round(stats.retention_pct * 100)}% retention`] : []),
  ].join(" · ");

  return (
    <section className="dh-surface dh-surface--raised dh-home-today">
      <div className="dh-home-today__top">
        {/* Keyed on the deck so the numbers rise in when the scope changes. */}
        <div key={deckId ?? "all"} className="dh-home-today__copy dh-home-today__swap">
          <h2>
            {ready.toLocaleString()} card{ready === 1 ? "" : "s"} ready
          </h2>
          <p>
            About {estimateStudyDuration(ready)}
            {deck ? ` · ${deck.name}` : reviewed > 0 ? ` · ${reviewed.toLocaleString()} reviewed already` : ""}
          </p>
        </div>
        <Link href={reviewHref} className="btn btn-primary dh-home-today__start">
          Start review
          <kbd className="dh-kbd">↵</kbd>
        </Link>
      </div>
      <div
        className="dh-home-today__split"
        role="img"
        aria-label={`${deck ? "" : `${reviewed} done, `}${due} due, ${fresh} new`}
      >
        <i className="is-done" style={{ flexGrow: reviewed }} title={`${reviewed} reviewed`} />
        <i className="is-due" style={{ flexGrow: due }} title={`${due} due`} />
        <i style={{ flexGrow: fresh }} title={`${fresh} new`} />
      </div>
      <div key={deckId ?? "all"} className="dh-home-today__legend dh-home-today__swap">
        {deck ? null : (
          <span>
            <b>{reviewed.toLocaleString()}</b> done
          </span>
        )}
        <span>
          <b>{due.toLocaleString()}</b> due
        </span>
        <span>
          <b>{fresh.toLocaleString()}</b> new
        </span>
      </div>
      <div className="dh-home-today__foot">
        <DeckPicker decks={stats.per_deck} selected={deck} onSelect={setDeckId} />
        <Link href={examHref} className="dh-home-tool">
          <i className="ri-calendar-event-line" aria-hidden />
          Exams
        </Link>
        <span className="dh-spacer" />
        <Link href="/insights" className="dh-home-tool">
          <i className="ri-fire-line" aria-hidden />
          {summary}
        </Link>
      </div>
    </section>
  );
}

function CaughtUpCard({ stats }: { stats: DashboardStats }) {
  const examHref = useExamHref();
  const todayKey = toIsoDateKey(new Date());
  const { data: heatmap } = useReviewHeatmap(new Date().getFullYear());
  const subline = [
    stats.reviewed_today > 0 ? `${stats.reviewed_today.toLocaleString()} reviewed today` : "Nothing due right now",
    nextCardsLabel(stats.per_deck, heatmap?.forecast ?? {}, todayKey),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="dh-surface dh-surface--raised dh-home-today dh-home-today--done">
      <div className="dh-home-today__top">
        <div className="dh-home-today__copy">
          <h2>You&apos;re all caught up</h2>
          <p>{subline}</p>
        </div>
        <Link href={examHref} className="btn btn-secondary">
          <i className="ri-calendar-event-line" aria-hidden />
          Exams
        </Link>
      </div>
    </section>
  );
}

function DeckList({
  title,
  decks,
  showDue,
}: {
  title: string;
  decks: DashboardStats["per_deck"];
  showDue: boolean;
}) {
  if (decks.length === 0) return null;
  return (
    <section>
      <div className="dh-section-label dh-home-list__label">
        {title}
        <span className="dh-spacer" />
        <Link href="/decks">All decks</Link>
      </div>
      <div>
        {decks.map((deck) => (
          <Link key={deck.deck_id} href={`/decks/${deck.deck_id}`} className="dh-home-list__row">
            <span className="dh-home-list__name">{deck.name}</span>
            {showDue ? (
              <span className="dh-count dh-count--due dh-home-list__due">{deck.due} due</span>
            ) : null}
            <span className="dh-home-list__when">{formatRelative(deck.last_reviewed)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FirstRun() {
  return (
    <div className="dh-home dh-home--first">
      <Greeting>What are we studying first?</Greeting>
      <HomeComposer variant="start" placeholder="Name a topic, paste your notes, or add a source…" />
      <div className="dh-home__chips">
        <Link href="/create" className="dh-filter">
          <i className="ri-file-text-line" aria-hidden />
          Document
        </Link>
        <Link href="/create" className="dh-filter">
          <i className="ri-youtube-line" aria-hidden />
          YouTube
        </Link>
        <Link href="/create?import=anki" className="dh-filter">
          <i className="ri-download-2-line" aria-hidden />
          Import Anki or Quizlet
        </Link>
        <Link href="/community" className="dh-filter">
          <i className="ri-group-line" aria-hidden />
          Browse Community
        </Link>
      </div>
      <UpgradeLink />
    </div>
  );
}

function UpgradeLink() {
  const { plan } = useAppShellUser();
  const { openSettings } = useSettings();
  if (plan !== "basic") return null;
  return (
    <button type="button" className="dh-home-tool dh-home__upgrade" onClick={() => openSettings("billing")}>
      <i className="ri-vip-crown-line" aria-hidden />
      Upgrade to Plus or Pro
    </button>
  );
}

export function HomeSkeleton() {
  return (
    <div className="dh-home" aria-busy>
      <div className="dh-home__greet">
        <SkeletonBar width={340} height={40} radius={10} />
      </div>
      <div className="dh-surface dh-surface--raised dh-home-today">
        <SkeletonBar width={180} height={26} radius={8} />
        <SkeletonBar width={240} height={12} style={{ marginTop: 12 }} />
        <SkeletonBar height={6} style={{ margin: "26px 0 56px" }} />
      </div>
      <div className="dh-home-composer dh-home-composer--flat">
        <SkeletonBar width="70%" height={12} style={{ margin: "8px 6px 34px" }} />
      </div>
    </div>
  );
}

export function HomeView() {
  const { displayName } = useAppShellUser();
  const { data: stats, error, mutate } = useDashboardStats();
  const hour = useLocalHour();

  if (!stats) {
    if (!error) return <HomeSkeleton />;
    return (
      <div className="dh-home">
        <Greeting>{hour === null ? " " : timeOfDayGreeting(displayName, hour)}</Greeting>
        <LoadErrorState label="your study overview" onRetry={() => void mutate()} />
        <HomeComposer placeholder={COMPOSER_PLACEHOLDER} />
      </div>
    );
  }

  if (stats.per_deck.length === 0) return <FirstRun />;

  const hasWork = stats.due_now + stats.new_today_remaining > 0;
  const continueDecks = pickContinueDecks(stats.per_deck);
  const decks = stats.per_deck.map((deck) => ({ id: deck.deck_id, name: deck.name }));

  return (
    <div className="dh-home">
      <Greeting>{hour === null ? " " : timeOfDayGreeting(displayName, hour)}</Greeting>
      {hasWork ? <TodayCard stats={stats} /> : <CaughtUpCard stats={stats} />}
      <HomeComposer placeholder={COMPOSER_PLACEHOLDER} decks={decks} />
      {hasWork && continueDecks.length > 0 ? (
        <DeckList title="Pick up where you left off" decks={continueDecks} showDue />
      ) : (
        <DeckList title="Recently studied" decks={pickRecentDecks(stats.per_deck)} showDue={false} />
      )}
      <UpgradeLink />
    </div>
  );
}
