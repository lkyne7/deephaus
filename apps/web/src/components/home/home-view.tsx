"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import useSWR from "swr";
import { BrandMark } from "@/components/brand-mark";
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

const ACTIVE_CRAM_PLANS_KEY = `${cacheKeys.cramPlans}?status=active`;

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

function useCramHref(): string {
  const { data } = useSWR<{ plans?: unknown[] }>(ACTIVE_CRAM_PLANS_KEY);
  const hasActive = Array.isArray(data?.plans) && data.plans.length > 0;
  // No active plans: create one. While loading, prefer /cram so running plans aren't skipped.
  return data && !hasActive ? "/cram/new" : "/cram";
}

function Greeting({ children }: { children: ReactNode }) {
  return (
    <h1 className="dh-home__greet">
      <BrandMark size={43} title={null} />
      {children}
    </h1>
  );
}

function TodayCard({ stats }: { stats: DashboardStats }) {
  const router = useRouter();
  const cramHref = useCramHref();
  const ready = stats.due_now + stats.new_today_remaining;
  const reviewed = stats.reviewed_today;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target !== document.body) return;
      event.preventDefault();
      router.push("/review");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const summary = [
    `${stats.streak}-day streak`,
    ...(stats.retention_pct !== null ? [`${Math.round(stats.retention_pct * 100)}% retention`] : []),
  ].join(" · ");

  return (
    <section className="dh-surface dh-surface--raised dh-home-today">
      <div className="dh-home-today__top">
        <div className="dh-home-today__copy">
          <h2>
            {ready.toLocaleString()} card{ready === 1 ? "" : "s"} ready
          </h2>
          <p>
            About {estimateStudyDuration(ready)}
            {reviewed > 0 ? ` · ${reviewed.toLocaleString()} reviewed already` : ""}
          </p>
        </div>
        <Link href="/review" className="btn btn-primary dh-home-today__start">
          Start review
          <kbd className="dh-kbd">↵</kbd>
        </Link>
      </div>
      <div
        className="dh-home-today__split"
        role="img"
        aria-label={`${reviewed} done, ${stats.due_now} due, ${stats.new_today_remaining} new`}
      >
        <i className="is-done" style={{ flexGrow: reviewed }} title={`${reviewed} reviewed`} />
        <i className="is-due" style={{ flexGrow: stats.due_now }} title={`${stats.due_now} due`} />
        <i style={{ flexGrow: stats.new_today_remaining }} title={`${stats.new_today_remaining} new`} />
      </div>
      <div className="dh-home-today__legend">
        <span>
          <b>{reviewed.toLocaleString()}</b> done
        </span>
        <span>
          <b>{stats.due_now.toLocaleString()}</b> due
        </span>
        <span>
          <b>{stats.new_today_remaining.toLocaleString()}</b> new
        </span>
      </div>
      <div className="dh-home-today__foot">
        <Link href="/decks" className="dh-home-tool">
          <i className="ri-folder-3-line" aria-hidden />
          Choose a deck
        </Link>
        <Link href={cramHref} className="dh-home-tool">
          <i className="ri-flashlight-line" aria-hidden />
          Cram
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
  const cramHref = useCramHref();
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
        <Link href={cramHref} className="btn btn-secondary">
          <i className="ri-flashlight-line" aria-hidden />
          Cram
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
