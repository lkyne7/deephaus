"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { DetailLevel, FocusPreset } from "@deephaus/shared";
import { DeckActionsMenu } from "@/components/deck-actions-menu";
import { DeckCardsTab } from "@/components/deck-page/deck-cards-tab";
import { DeckComposer } from "@/components/deck-page/deck-composer";
import { DeckForecastMini, DeckForecastTab } from "@/components/deck-page/deck-forecast";
import {
  DeckSettingsPanel,
  deckPresetApplies,
  schedulingLabel,
  type DeckSettings,
  type DeckStudyValues,
} from "@/components/deck-page/deck-settings-panel";
import { DeckSharingPanel } from "@/components/deck-page/deck-sharing-panel";
import { DeckSourcesTab } from "@/components/deck-page/deck-sources-tab";
import { FadeIn } from "@/components/motion/fade-in";
import { apiFetch } from "@/lib/api/fetch";
import type { DeckSourceListItem } from "@/app/api/projects/[id]/sources/route";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { learnerLabel } from "@/lib/community/labels";
import type { DeckPublication } from "@/lib/community/types";
import { cardCountLabel, reviewedLabel } from "@/lib/decks/deck-list";
import "./deck-page.css";

export type DeckPanel = "settings" | "sharing";
type DeckTab = "cards" | "sources" | "forecast";

type Props = {
  projectId: string;
  title: string;
  cardCount: number;
  due: number;
  newCount: number;
  isOwner: boolean;
  publication: DeckPublication | null;
  jobId: string | null;
  jobStatus: string | null;
  jobError: string | null;
  jobProgress: number;
  initialSettings: DeckSettings;
  globalSettings: DeckStudyValues;
  effectiveSettings: DeckStudyValues;
  hasOptimizedParams: boolean;
  initialPanel: DeckPanel | null;
  composerDefaults: { detail: DetailLevel; focus: FocusPreset };
};

const TERMINAL = new Set(["ready", "failed"]);

function useDeckJob(jobId: string | null, jobStatus: string | null, jobProgress: number, jobError: string | null) {
  const router = useRouter();
  const [status, setStatus] = useState(jobStatus);
  const [progress, setProgress] = useState(jobProgress);
  const [error, setError] = useState(jobError);

  useEffect(() => {
    setStatus(jobStatus);
    setProgress(jobProgress);
    setError(jobError);
  }, [jobStatus, jobProgress, jobError]);

  useEffect(() => {
    if (!jobId || (jobStatus && TERMINAL.has(jobStatus))) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const job = (await res.json()) as { status?: string; progress?: number; error?: string | null };
        if (cancelled) return;
        const next = job.status ?? null;
        setStatus(next);
        setProgress(typeof job.progress === "number" ? job.progress : 0);
        if (job.error) setError(job.error);
        if (next && TERMINAL.has(next)) {
          if (interval) clearInterval(interval);
          router.refresh();
        }
      } catch {
        // Ignore transient poll errors.
      }
    }

    void poll();
    interval = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, jobStatus, router]);

  return { status, progress, error, generating: Boolean(status && !TERMINAL.has(status)) };
}

export function DeckPageView({
  projectId,
  title: initialTitle,
  cardCount,
  due,
  newCount,
  isOwner,
  publication: initialPublication,
  jobId,
  jobStatus,
  jobError,
  jobProgress,
  initialSettings,
  globalSettings,
  effectiveSettings,
  hasOptimizedParams,
  initialPanel,
  composerDefaults,
}: Props) {
  const router = useRouter();
  const { data: stats } = useDashboardStats();
  const job = useDeckJob(jobId, jobStatus, jobProgress, jobError);
  const [title, setTitle] = useState(initialTitle);
  const [panel, setPanel] = useState<DeckPanel | null>(initialPanel);
  const [tab, setTab] = useState<DeckTab>("cards");
  const [publication, setPublication] = useState(initialPublication);
  const [sources, setSources] = useState<DeckSourceListItem[] | null>(null);
  const [sourcesFailed, setSourcesFailed] = useState(false);

  const statsRow = stats?.per_deck.find((deck) => deck.deck_id === projectId);
  const isCommunity = !isOwner || Boolean(statsRow?.is_community);
  const empty = cardCount === 0;
  const studyCount = due + newCount;

  useEffect(() => setTitle(initialTitle), [initialTitle, projectId]);
  useEffect(() => setPublication(initialPublication), [initialPublication]);

  const loadSources = useCallback(async () => {
    setSourcesFailed(false);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/sources`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { sources: DeckSourceListItem[] };
      setSources(data.sources);
    } catch {
      setSourcesFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (!panel) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role='dialog']")) {
        setPanel(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const canOpenSharing = isOwner && !isCommunity && !empty;
  const openSharing = useCallback(() => setPanel("sharing"), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const hasDeckOverride = deckPresetApplies(initialSettings.fsrsParams);

  return (
    <div className={`dhd${panel ? " dhd--panel" : ""}`}>
      <div className="dhd-scroll">
        <div className="dhd-layout">
          <div className="dhd-main">
            <nav className="dh-crumb" aria-label="Breadcrumb">
              <Link href="/decks">Decks</Link>
              <i className="ri-arrow-right-s-line" aria-hidden />
            </nav>
            <h1 className="dh-title dhd-title">{title}</h1>
            <div className="dhd-meta">
              <span>{cardCountLabel(cardCount)}</span>
              <span className="dh-count dh-count--due">{due.toLocaleString()} due</span>
              <span className="dh-count dh-count--new">{newCount.toLocaleString()} new</span>
              {statsRow ? <span>{reviewedLabel(statsRow.last_reviewed)}</span> : null}
              {statsRow?.is_community ? <span className="dh-pill dh-pill--outline">From Community</span> : null}
              {publication ? <span className="dh-pill dh-pill--accent">Published</span> : null}
            </div>

            <DeckBody
              projectId={projectId}
              empty={empty}
              job={job}
              isOwner={isOwner}
              tab={tab}
              setTab={setTab}
              cardCount={cardCount}
              sources={sources}
              sourcesFailed={sourcesFailed}
              onRetrySources={() => void loadSources()}
              effectiveSettings={effectiveSettings}
              composerDefaults={composerDefaults}
            />
          </div>

          {panel ? null : (
            <aside className="dhd-rail" aria-label="Deck actions and settings">
              <div className="dhd-rail__actions">
                {empty ? (
                  <button type="button" className="btn btn-primary dhd-study" disabled>
                    Study
                  </button>
                ) : (
                  <Link href={`/decks/${projectId}/study`} className="btn btn-primary dhd-study">
                    {studyCount > 0 ? `Study ${cardCountLabel(studyCount)}` : "Study"}
                  </Link>
                )}
                <DeckActionsMenu
                  deck={{
                    id: projectId,
                    title,
                    cardCount,
                    isPublished: Boolean(publication),
                    isCommunity,
                  }}
                  omit={["open", "study"]}
                  variant="rail"
                  onRenamed={(name) => {
                    setTitle(name);
                    router.refresh();
                  }}
                  onDuplicated={(copy) => router.push(`/decks/${copy.id}`)}
                  onDeleted={() => router.push("/decks")}
                  onPublish={openSharing}
                />
              </div>

              {isOwner && !empty ? (
                <section className="dh-surface dhd-box">
                  <h2>Next 30 days</h2>
                  <DeckForecastMini
                    projectId={projectId}
                    newPerDay={effectiveSettings.newCardsPerDay}
                    retention={effectiveSettings.desiredRetention}
                  />
                </section>
              ) : null}

              <section className="dh-surface dhd-box">
                <h2>
                  Study settings
                  <span className="dh-spacer" />
                  <button type="button" className="btn btn-ghost btn-sm dhd-box__edit" onClick={() => setPanel("settings")}>
                    Edit
                  </button>
                </h2>
                <div className="dhd-kv">
                  <dt>Desired retention</dt>
                  <dd>{Math.round(effectiveSettings.desiredRetention * 100)}%</dd>
                </div>
                <div className="dhd-kv">
                  <dt>New cards per day</dt>
                  <dd>{effectiveSettings.newCardsPerDay}</dd>
                </div>
                <div className="dhd-kv">
                  <dt>Scheduling</dt>
                  <dd>
                    <span className="dh-pill">{schedulingLabel(hasDeckOverride, hasOptimizedParams)}</span>
                  </dd>
                </div>
              </section>

              {isOwner ? (
                <section className="dh-surface dhd-box">
                  <h2>Sharing</h2>
                  {isCommunity ? (
                    <p className="dhd-muted">Added from Community. Decks from Community can&apos;t be published.</p>
                  ) : empty ? (
                    <p className="dhd-muted">Add cards before publishing.</p>
                  ) : publication ? (
                    <>
                      <p className="dhd-muted">Published · {learnerLabel(publication.subscriber_count)}</p>
                      {publication.description ? (
                        <p className="dhd-muted dhd-box__clamp">{publication.description}</p>
                      ) : null}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={openSharing}>
                        Manage sharing
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="dhd-muted">Private. Publish so other people can try it and add it to their decks.</p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={openSharing}>
                        Publish to Community
                      </button>
                    </>
                  )}
                </section>
              ) : null}
            </aside>
          )}
        </div>
      </div>

      {panel === "settings" ? (
        <DeckSettingsPanel
          projectId={projectId}
          initialSettings={initialSettings}
          globalSettings={globalSettings}
          hasOptimizedParams={hasOptimizedParams}
          showForecast={isOwner && !empty}
          onClose={closePanel}
        />
      ) : null}
      {panel === "sharing" && canOpenSharing ? (
        <DeckSharingPanel
          projectId={projectId}
          deckName={title}
          cardCount={cardCount}
          publication={publication}
          onPublicationChange={setPublication}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}

function DeckBody({
  projectId,
  empty,
  job,
  isOwner,
  tab,
  setTab,
  cardCount,
  sources,
  sourcesFailed,
  onRetrySources,
  effectiveSettings,
  composerDefaults,
}: {
  projectId: string;
  empty: boolean;
  job: ReturnType<typeof useDeckJob>;
  isOwner: boolean;
  tab: DeckTab;
  setTab: (tab: DeckTab) => void;
  cardCount: number;
  sources: DeckSourceListItem[] | null;
  sourcesFailed: boolean;
  onRetrySources: () => void;
  effectiveSettings: DeckStudyValues;
  composerDefaults: Props["composerDefaults"];
}) {
  if (job.status === "failed" && empty) {
    return (
      <FadeIn>
        <div className="dh-empty dhd-state">
          <h2>Generation failed</h2>
          <p>{job.error ?? "Try generating again with different settings."}</p>
          <Link href={`/create?deck=${projectId}`} className="btn btn-primary">
            Try Again
          </Link>
        </div>
      </FadeIn>
    );
  }

  if (job.generating && empty) {
    return (
      <FadeIn>
        <div className="dh-empty dhd-state">
          <h2>Generating your flashcards…</h2>
          <p>This usually takes a few seconds.</p>
          <div className="dh-meter dhd-state__meter">
            <span style={{ width: `${Math.max(job.progress, 30)}%` }} />
          </div>
        </div>
      </FadeIn>
    );
  }

  if (empty) {
    return (
      <FadeIn>
        <div className="dh-empty dhd-state">
          <h2>No cards yet</h2>
          <p>Add a source to generate cards for this deck.</p>
          <Link href={`/create?deck=${projectId}`} className="btn btn-primary">
            Add cards
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <>
      <DeckComposer deckId={projectId} defaults={composerDefaults} />
      <div className="dh-tabs dhd-tabs" role="tablist" aria-label="Deck content">
        <button type="button" role="tab" aria-selected={tab === "cards"} onClick={() => setTab("cards")}>
          Cards<span>{cardCount.toLocaleString()}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>
          Sources{sources ? <span>{sources.length.toLocaleString()}</span> : null}
        </button>
        {isOwner ? (
          <button type="button" role="tab" aria-selected={tab === "forecast"} onClick={() => setTab("forecast")}>
            Forecast
          </button>
        ) : null}
      </div>
      {tab === "cards" ? <DeckCardsTab deckId={projectId} /> : null}
      {tab === "sources" ? (
        <DeckSourcesTab deckId={projectId} sources={sources} failed={sourcesFailed} onRetry={onRetrySources} />
      ) : null}
      {tab === "forecast" ? (
        <DeckForecastTab
          projectId={projectId}
          defaultNewPerDay={effectiveSettings.newCardsPerDay}
          defaultRetention={effectiveSettings.desiredRetention}
        />
      ) : null}
    </>
  );
}
