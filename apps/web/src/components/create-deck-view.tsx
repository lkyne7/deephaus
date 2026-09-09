"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseGenerationSettings,
  FOCUS_PRESET_OPTIONS,
  DEFAULT_FOCUS_PRESET,
  focusPresetOption,
  type FocusPreset,
  type DetailLevel,
  type DraftCard,
  type ImageOcclusionData,
  type GenerationCardType,
  GENERATION_CARD_TYPE_OPTIONS,
  DETAIL_LEVEL_OPTIONS,
  detailLevelLabel,
  type CardType,
} from "@deephaus/shared";
import { AnkiImportOverlay } from "@/components/anki-import-overlay";
import type { DeckImportMode } from "@/components/deck-import-view";
import { CardEditOverlay, type OverlayCard } from "@/components/card-edit-overlay";
import {
  SourceImageOcclusionDialog,
  type SourceImageOcclusionTarget,
} from "@/components/image-occlusion/source-image-occlusion-dialog";
import {
  SourceDocumentEditor,
  type SourceImageSelection,
} from "@/components/source-document-editor";
import { SourceFileViewer } from "@/components/source-file-viewer";
import { SourcesFlyout } from "@/components/create/sources-flyout";
import { CreateCardsPane, type CardAiAction } from "@/components/create/create-cards-pane";
import {
  CardAssistantBar,
  type CardAssistantPlacement,
  type CardAssistantResult,
  type CardAssistantScope,
  type CardAssistantStatus,
} from "@/components/create/card-assistant-bar";
import { assistantEditCardsApi } from "@/lib/cards/assistant-edit-client";
import { generateCardMnemonicApi, regenerateCardApi } from "@/lib/cards/card-ai-actions-client";
import { updateCardApi } from "@/lib/cards/update";
import { deleteSourceApi } from "@/lib/sources/delete-source-client";
import {
  AddSourceOverlay,
  type AddSourcePayload,
  type AddSourceSubmitOptions,
} from "@/components/create/add-source-overlay";
import { DeckActionsMenu } from "@/components/deck-actions-menu";
import type { SourceCardLink } from "@/components/source-card-links";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";
import { useAiContext } from "@/lib/ai-assistant/context";
import { cardPreviewText, type BrowseCardRow } from "@/lib/browse/cards";
import {
  fetchDeckSources,
  sourceHasOriginal,
  type DeckSource,
} from "@/lib/sources/deck-sources";
import { readJson as readApiJson } from "@/lib/background-tasks/api";
import { useBackgroundTasks } from "@/lib/background-tasks/context";
import {
  AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE,
  isAiCreditsExhaustedMessage,
} from "@/lib/credits/exhausted-message";
import { useSettings } from "@/components/settings/settings-context";
import { prefetchSourceDocument } from "@/lib/sources/source-document-cache";
import { apiFetch } from "@/lib/api/fetch";
import { isAuthNetworkError } from "@/lib/auth-errors";
import "@/components/rich-text/rich-text.css";

type DeckOption = { id: string; name: string };
type SourceViewTab = "notes" | "original";

const NEW_DECK_VALUE = "__new__";
const CARD_PAGE_SIZE = 50;

/** Source/cards split: percentage width of the source pane, persisted locally. */
const SPLIT_STORAGE_KEY = "dh-create-split-pct";
const SPLIT_MIN_PCT = 28;
const SPLIT_MAX_PCT = 72;
const SPLIT_DEFAULT_PCT = 50;
/** Whether linked-card highlights are shown in the Create source document. */
const HIGHLIGHTS_STORAGE_KEY = "dh-create-show-card-highlights";
/** Whether the sources rail is collapsed to a slim icon strip. */
async function readJson<T>(res: Response): Promise<T> {
  return readApiJson<T>(res);
}

function friendlyError(err: unknown, fallback: string): string {
  if (isAuthNetworkError(err as { message?: string; name?: string })) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

function draftToOverlayCard(card: DraftCard): OverlayCard {
  return {
    id: card.id,
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.occlusion_data,
    tags: card.tags ?? [],
    source_ref: card.source_ref ?? null,
    source_quote: card.source_quote ?? null,
  };
}

function browseRowToDraft(row: BrowseCardRow): DraftCard {
  return {
    id: row.id,
    job_id: "",
    type: row.type,
    front: row.front,
    back: row.back,
    cloze_text: row.cloze_text,
    extra: row.extra,
    occlusion_data: row.occlusion_data,
    tags: row.tags ?? [],
    sort_order: row.sort_order,
    user_edited: row.user_edited,
    source_ref: row.source_ref ?? null,
    source_quote: row.source_quote ?? null,
    created_at: "",
    updated_at: "",
  };
}

/** Map a POST /api/cards row into the Create queue DraftCard shape. */
function apiCardToDraft(card: {
  id: string;
  job_id?: string | null;
  type: DraftCard["type"];
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  occlusion_data?: unknown;
  tags?: string[] | null;
  sort_order?: number | null;
  user_edited?: boolean | null;
  source_ref?: string | null;
  source_quote?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}): DraftCard {
  return {
    id: card.id,
    job_id: card.job_id ?? "",
    type: card.type,
    front: card.front ?? null,
    back: card.back ?? null,
    cloze_text: card.cloze_text ?? null,
    extra: card.extra ?? null,
    occlusion_data: card.occlusion_data,
    tags: card.tags ?? [],
    sort_order: card.sort_order ?? 0,
    user_edited: card.user_edited ?? true,
    source_ref: card.source_ref ?? null,
    source_quote: card.source_quote ?? null,
    created_at: card.created_at ?? "",
    updated_at: card.updated_at ?? "",
  };
}

/** Editable fields captured before an assistant run so Undo can restore them. */
type AssistantSnapshot = Pick<DraftCard, "front" | "back" | "cloze_text" | "extra" | "tags">;

function snapshotOf(card: DraftCard): AssistantSnapshot {
  return {
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    tags: [...card.tags],
  };
}

/** Short plain-text preview used in the assistant scope label. */
function cardScopePreview(card: DraftCard): string {
  const text = cardPreviewText(card)
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{c\d+::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

type LoadDeckCardsOptions = {
  /** Append the next page (infinite scroll). */
  append?: boolean;
  /** Refresh without swapping the list for a skeleton (keeps scroll + mounted rows). */
  soft?: boolean;
  /**
   * With soft: keep pages already loaded beyond the first page (generation).
   * Without: replace the list entirely (deck switch).
   */
  preserveLoaded?: boolean;
};

type Props = {
  initialDeckId?: string | null;
  initialSourceId?: string | null;
  initialImportMode?: DeckImportMode | null;
};

export function CreateDeckView({
  initialDeckId = null,
  initialSourceId = null,
  initialImportMode = null,
}: Props) {
  const router = useRouter();
  const { tasks, getTaskForProject, startDeckGeneration, startMultiSourceGeneration } =
    useBackgroundTasks();
  const { openSettings } = useSettings();
  const [deckName, setDeckName] = useState("");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [selectedTypes, setSelectedTypes] = useState<Set<GenerationCardType>>(
    () => new Set<GenerationCardType>(["basic"]),
  );
  const [focusPreset, setFocusPreset] = useState<FocusPreset>(DEFAULT_FOCUS_PRESET);
  const [clozeHints, setClozeHints] = useState(true);
  const [autoTags, setAutoTags] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [existingDecks, setExistingDecks] = useState<DeckOption[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsRefreshing, setCardsRefreshing] = useState(false);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [decksLoading, setDecksLoading] = useState(true);
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  /** Brief flash highlight for cards just added (generate / manual). */
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  /** Multi-select in the cards pane (checkboxes / shift-click / ⌘A). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // --- Card assistant (bulk AI edit) ---------------------------------------
  const [assistantOpen, setAssistantOpen] = useState(false);
  /** When set, the assistant is scoped to this single card (per-card sparkle). */
  const [assistantCardId, setAssistantCardId] = useState<string | null>(null);
  const [assistantPlacement, setAssistantPlacement] = useState<CardAssistantPlacement>("fab");
  const [assistantAnchorEl, setAssistantAnchorEl] = useState<HTMLElement | null>(null);
  const listPaneRef = useRef<HTMLDivElement>(null);
  const [assistantStatus, setAssistantStatus] = useState<CardAssistantStatus>("idle");
  const [assistantResult, setAssistantResult] = useState<CardAssistantResult | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantUndoing, setAssistantUndoing] = useState(false);
  /** Per-card one-click AI actions in flight (tile lightbulb / refresh buttons). */
  const [cardActionBusy, setCardActionBusy] = useState<Map<string, CardAiAction>>(() => new Map());
  /** Last one-click rewrite (mnemonic / regenerate), kept briefly so it can be undone from the tile. */
  const [regenNotice, setRegenNotice] = useState<{
    id: string;
    action: CardAiAction;
    previous: AssistantSnapshot;
  } | null>(null);
  const regenNoticeTimerRef = useRef<number | null>(null);
  /** Cards being rewritten right now (pulse animation). */
  const [pulseIds, setPulseIds] = useState<Set<string>>(() => new Set());
  /** Previous field values for the last assistant run, keyed by card id (Undo). */
  const assistantSnapshotRef = useRef<Map<string, AssistantSnapshot>>(new Map());
  /** All sources attached to the deck (NotebookLM-style rail). */
  const [sources, setSources] = useState<DeckSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [sourceImageOcclusionTarget, setSourceImageOcclusionTarget] =
    useState<SourceImageOcclusionTarget | null>(null);
  /** Text (editable document) vs Original (uploaded file) in the middle pane. */
  const [viewTab, setViewTab] = useState<SourceViewTab>("notes");
  /** Drives "View in source": opens the card's linked source and scrolls to its snippet. */
  const [sourceScrollTarget, setSourceScrollTarget] = useState<{ text: string; nonce: number } | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const cardRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const flashTimersRef = useRef<Map<string, number>>(new Map());
  const cardsRef = useRef<DraftCard[]>([]);
  const cardsLengthRef = useRef(0);
  const loadingMoreCardsRef = useRef(false);
  const activeSourceIdRef = useRef<string | null>(null);
  const pendingSourceSelectRef = useRef<string | null>(initialSourceId);
  /** Width of the source pane as a % of the split body; draggable via divider. */
  const [sourcePanePct, setSourcePanePct] = useState(SPLIT_DEFAULT_PCT);
  const [splitDragging, setSplitDragging] = useState(false);
  /** Show/hide card-linked passage highlights in the source document. */
  const [showCardHighlights, setShowCardHighlights] = useState(true);
  const splitBodyRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [deckImportOpen, setDeckImportOpen] = useState(Boolean(initialImportMode));
  const [deckImportMode, setDeckImportMode] = useState<DeckImportMode>(
    initialImportMode ?? "anki",
  );
  const lastSyncedTaskRef = useRef<string | null>(null);

  const openDeckImport = useCallback((mode: DeckImportMode) => {
    setDeckImportMode(mode);
    setDeckImportOpen(true);
  }, []);

  const activeTask = useMemo(() => {
    if (activeTaskId) {
      return tasks.find((task) => task.id === activeTaskId);
    }
    if (projectId) {
      return getTaskForProject(projectId);
    }
    return undefined;
  }, [activeTaskId, getTaskForProject, projectId, tasks]);

  const generating = activeTask?.status === "running" && activeTask.kind !== "source";
  /** A source is still uploading/extracting for this deck. */
  const sourceTaskRunning = useMemo(
    () =>
      tasks.some(
        (task) =>
          task.kind === "source" &&
          task.projectId === projectId &&
          task.status === "running",
      ),
    [tasks, projectId],
  );

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? null,
    [sources, activeSourceId],
  );

  useEffect(() => {
    activeSourceIdRef.current = activeSourceId;
  }, [activeSourceId]);

  // Original tab only exists for file-backed sources; fall back to Text.
  useEffect(() => {
    setViewTab("notes");
  }, [activeSourceId]);

  const headerMenuItems = useMemo<TopbarMenuItem[]>(() => {
    const items: TopbarMenuItem[] = [
      {
        id: "import-apkg",
        label: "Import from Anki",
        icon: "ri-folder-download-line",
        onClick: () => openDeckImport("anki"),
      },
      {
        id: "import-quizlet",
        label: "Import from Quizlet",
        icon: "ri-file-copy-2-line",
        onClick: () => openDeckImport("quizlet"),
      },
    ];
    if (projectId) {
      items.push({
        id: "open-deck",
        label: "Open deck",
        icon: "ri-stack-line",
        href: `/decks/${projectId}`,
      });
    }
    return items;
  }, [projectId, openDeckImport]);

  const focused = useMemo(
    () => cards.find((c) => c.id === focusedId) ?? null,
    [cards, focusedId],
  );

  /** Evidence quotes to highlight in the source document (source → card links). */
  const cardLinks = useMemo<SourceCardLink[]>(
    () =>
      showCardHighlights
        ? cards
            .filter((c) => (c.source_quote ?? "").trim().length > 0)
            .map((c) => ({ cardId: c.id, quote: c.source_quote as string }))
        : [],
    [cards, showCardHighlights],
  );

  useAiContext({
    page: "create",
    deckId: projectId,
    card: focused
      ? {
          id: focused.id,
          type: focused.type,
          front: focused.front,
          back: focused.back,
          cloze_text: focused.cloze_text,
          extra: focused.extra,
        }
      : null,
    sourceText: null,
  });

  useEffect(() => {
    cardsLengthRef.current = cards.length;
    cardsRef.current = cards;
  }, [cards.length, cards]);

  const flashCardIds = useCallback((ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return;
    setFlashIds((prev) => {
      const next = new Set(prev);
      for (const id of unique) next.add(id);
      return next;
    });
    for (const id of unique) {
      const existing = flashTimersRef.current.get(id);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        flashTimersRef.current.delete(id);
      }, 1800);
      flashTimersRef.current.set(id, timer);
    }
  }, []);

  const scrollCardIntoView = useCallback((id: string) => {
    const tryScroll = (attemptsLeft: number) => {
      const el = cardRowRefs.current.get(id);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (attemptsLeft <= 0) return;
      requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
    };
    requestAnimationFrame(() => tryScroll(8));
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of flashTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      flashTimersRef.current.clear();
    };
  }, []);

  /** Close the assistant and forget the last run (deck switch / new deck). */
  const resetAssistant = useCallback(() => {
    setAssistantOpen(false);
    setAssistantCardId(null);
    setAssistantStatus("idle");
    setAssistantResult(null);
    setAssistantError(null);
    setPulseIds(new Set());
    assistantSnapshotRef.current = new Map();
  }, []);

  const loadDeckCards = useCallback(
    async (deckId: string, options: boolean | LoadDeckCardsOptions = false) => {
      const opts: LoadDeckCardsOptions =
        typeof options === "boolean" ? { append: options } : options;
      const append = Boolean(opts.append);
      const soft = Boolean(opts.soft) && !append;

      if (append) {
        if (loadingMoreCardsRef.current) return [] as DraftCard[];
        loadingMoreCardsRef.current = true;
        setLoadingMoreCards(true);
      } else if (soft) {
        setCardsRefreshing(true);
      } else {
        setCardsLoading(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({
          deck_id: deckId,
          limit: String(CARD_PAGE_SIZE),
          offset: String(append ? cardsLengthRef.current : 0),
        });
        const res = await apiFetch(`/api/browse/cards?${params}`, { credentials: "include" });
        const data = await readJson<{ cards: BrowseCardRow[]; total: number }>(res);
        const nextCards = data.cards.map(browseRowToDraft);
        if (append) {
          setCards((prev) => {
            const existing = new Set(prev.map((c) => c.id));
            return [...prev, ...nextCards.filter((c) => !existing.has(c.id))];
          });
        } else if (soft && opts.preserveLoaded) {
          // Keep later pages that were already loaded; put the refreshed first page first.
          setCards((prev) => {
            const incomingIds = new Set(nextCards.map((c) => c.id));
            const rest = prev.filter((c) => !incomingIds.has(c.id));
            return [...nextCards, ...rest];
          });
        } else {
          setCards(nextCards);
        }
        setTotalCards(data.total);
        return nextCards;
      } catch (err) {
        if (!append) {
          setError(friendlyError(err, "Could not load deck cards"));
          if (!soft) {
            setCards([]);
            setTotalCards(0);
          }
        }
        return [] as DraftCard[];
      } finally {
        if (append) {
          loadingMoreCardsRef.current = false;
          setLoadingMoreCards(false);
        } else if (soft) {
          setCardsRefreshing(false);
        } else {
          setCardsLoading(false);
        }
      }
    },
    [],
  );

  const loadProjectSources = useCallback(
    async (deckId: string, opts?: { selectSourceId?: string | null }) => {
      try {
        const next = await fetchDeckSources(deckId);
        setSources(next);
        const preferred = opts?.selectSourceId ?? pendingSourceSelectRef.current;
        pendingSourceSelectRef.current = null;
        const current = activeSourceIdRef.current;
        const resolved =
          preferred && next.some((source) => source.id === preferred)
            ? preferred
            : current && next.some((source) => source.id === current)
              ? current
              : next[0]?.id ?? null;
        setActiveSourceId(resolved);
        // Warm the document cache while cards/settings finish loading.
        if (resolved) void prefetchSourceDocument(resolved);
        return next;
      } catch {
        setSources([]);
        return [] as DeckSource[];
      }
    },
    [],
  );

  const activateExistingDeck = useCallback(
    async (deckId: string, decks: DeckOption[]) => {
      setProjectId(deckId);
      const deck = decks.find((d) => d.id === deckId);
      setDeckName(deck?.name ?? "");
      setFocusedId(null);
      setOverlayOpen(false);
      setCards([]);
      setTotalCards(0);
      setSources([]);
      setActiveSourceId(null);
      setError(null);
      setSelectedIds(new Set());
      resetAssistant();

      try {
        const projRes = await apiFetch(`/api/projects/${deckId}`, { credentials: "include" });
        const project = await readJson<{
          settings?: unknown;
          deck_name?: string | null;
          name?: string | null;
        }>(projRes);
        setDeckName(project.deck_name ?? project.name ?? "");
        const parsed = parseGenerationSettings(project.settings ?? {});
        setDetailLevel(parsed.detailLevel);
        const types = new Set<GenerationCardType>(parsed.cardTypes);
        if (types.size === 0) types.add("basic");
        setSelectedTypes(types);
        setFocusPreset(parsed.focusPreset ?? DEFAULT_FOCUS_PRESET);
        setClozeHints(parsed.clozeHints);
        setAutoTags(parsed.autoTags);
      } catch {
        // Keep deck name from list if project fetch fails.
      }

      // Soft card load avoids the full-list skeleton flash when toggling decks.
      await Promise.all([loadDeckCards(deckId, { soft: true }), loadProjectSources(deckId)]);
    },
    [loadDeckCards, loadProjectSources, resetAssistant],
  );

  const startNewDeck = useCallback(() => {
    setProjectId(null);
    setDeckName("");
    setCards([]);
    setTotalCards(0);
    setFocusedId(null);
    setSelectedIds(new Set());
    resetAssistant();
    setSources([]);
    setActiveSourceId(null);
    setDetailLevel("medium");
    setSelectedTypes(new Set<GenerationCardType>(["basic"]));
    setFocusPreset(DEFAULT_FOCUS_PRESET);
    setClozeHints(true);
    setAutoTags(true);
    setError(null);
    setAddSourceOpen(true);
  }, [resetAssistant]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDecksLoading(true);
      try {
        const res = await apiFetch("/api/projects", { credentials: "include" });
        const data = await readJson<
          Array<{ id: string; name: string; deck_name: string | null }>
        >(res);
        if (cancelled) return;
        const decks = data.map((p) => ({
          id: p.id,
          name: p.deck_name ?? p.name ?? "Untitled deck",
        }));
        setExistingDecks(decks);
        if (initialDeckId && decks.some((d) => d.id === initialDeckId)) {
          await activateExistingDeck(initialDeckId, decks);
        }
      } catch (err) {
        if (!cancelled) {
          setError(friendlyError(err, "Could not load decks"));
        }
      } finally {
        if (!cancelled) {
          setDecksLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDeckId, activateExistingDeck]);

  // A brand-new deck starts with an empty rail; open the add-source overlay so
  // the first action is obvious (skipped when arriving for a deck import).
  useEffect(() => {
    if (!initialDeckId && !initialImportMode) {
      setAddSourceOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  async function handleDeckChange(value: string) {
    if (value === NEW_DECK_VALUE) {
      startNewDeck();
      return;
    }
    await activateExistingDeck(value, existingDecks);
  }

  useEffect(() => {
    if (cards.length === 0) {
      setFocusedId(null);
      setOverlayOpen(false);
      return;
    }
    if (focusedId && !cards.some((c) => c.id === focusedId)) {
      setFocusedId(null);
      setOverlayOpen(false);
    }
  }, [cards, focusedId]);

  // Drop selections / single-card assistant scope for cards that no longer exist.
  useEffect(() => {
    const ids = new Set(cards.map((c) => c.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setAssistantCardId((prev) => (prev && !ids.has(prev) ? null : prev));
  }, [cards]);

  const textCardTypes = useMemo(
    () =>
      GENERATION_CARD_TYPE_OPTIONS.filter((o) => selectedTypes.has(o.value)).map(
        (o) => o.value,
      ),
    [selectedTypes],
  );

  const clozeSelected = selectedTypes.has("cloze");

  const toggleCardType = useCallback((value: GenerationCardType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        if (next.size === 1) return prev; // always keep at least one type
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const settings = useMemo(
    () => ({
      cardMix: textCardTypes[0] ?? "basic",
      cardTypes: textCardTypes,
      clozeHints: clozeSelected ? clozeHints : false,
      autoTags,
      detailLevel,
      focusPreset,
    }),
    [textCardTypes, clozeSelected, clozeHints, autoTags, detailLevel, focusPreset],
  );

  const cardTypeSummary = useMemo(
    () =>
      GENERATION_CARD_TYPE_OPTIONS.filter((o) => selectedTypes.has(o.value)).map(
        (o) => o.label,
      ),
    [selectedTypes],
  );

  const typePillValue = useMemo(() => {
    if (cardTypeSummary.length === 0) return "—";
    if (cardTypeSummary.length === 1) return cardTypeSummary[0]!;
    return "Mix";
  }, [cardTypeSummary]);

  const topbarDeckLabel = useMemo(() => {
    const fromList = existingDecks.find((d) => d.id === projectId)?.name;
    return (deckName ?? "").trim() || fromList || (projectId ? "Deck" : "New deck");
  }, [deckName, existingDecks, projectId]);

  // Refresh cards/sources when a background task for this deck completes.
  useEffect(() => {
    if (!projectId) return;
    const completed = tasks.find(
      (task) =>
        (task.kind === "generation" || task.kind === "source") &&
        task.projectId === projectId &&
        task.status === "ready" &&
        task.id !== lastSyncedTaskRef.current,
    );
    if (!completed) return;
    lastSyncedTaskRef.current = completed.id;

    if (completed.kind === "source") {
      void loadProjectSources(projectId, {
        selectSourceId: completed.sourceId ?? null,
      });
      return;
    }

    const previousIds = new Set(cardsRef.current.map((c) => c.id));
    void (async () => {
      const nextCards = await loadDeckCards(projectId, { soft: true, preserveLoaded: true });
      const newIds = nextCards.filter((c) => !previousIds.has(c.id)).map((c) => c.id);
      if (newIds.length > 0) {
        flashCardIds(newIds);
        scrollCardIntoView(newIds[0]!);
      }
    })();
    void loadProjectSources(projectId);
  }, [
    flashCardIds,
    loadDeckCards,
    loadProjectSources,
    projectId,
    scrollCardIntoView,
    tasks,
  ]);

  // Mirror failed background tasks for this deck into the page error banner —
  // the floating toast alone is easy to miss or dismiss by accident.
  const lastFailedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const failed = tasks.find(
      (task) =>
        (task.kind === "generation" || task.kind === "source") &&
        task.projectId === projectId &&
        task.status === "failed" &&
        task.id !== lastFailedTaskRef.current,
    );
    if (!failed) return;
    lastFailedTaskRef.current = failed.id;
    setError(failed.error?.trim() || `${failed.title} failed. Please try again.`);
  }, [projectId, tasks]);

  /** Create the deck row (used by add-source overlay + manual cards). */
  const createProject = useCallback(
    async (name: string): Promise<string> => {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, deck_name: name, settings }),
      });
      const project = await readJson<{ id: string }>(res);
      posthog.capture("deck_created", { deck_id: project.id });
      setProjectId(project.id);
      setDeckName(name);
      setExistingDecks((prev) => [
        { id: project.id, name },
        ...prev.filter((deck) => deck.id !== project.id),
      ]);
      router.replace(`/create?deck=${project.id}`);
      return project.id;
    },
    [settings, router],
  );

  const handleAddSourceSubmit = useCallback(
    async (payload: AddSourcePayload, newDeckName: string, options: AddSourceSubmitOptions) => {
      let pid = options.projectId ?? projectId;
      if (pid && pid !== projectId) {
        await activateExistingDeck(pid, existingDecks);
        router.replace(`/create?deck=${pid}`);
      }
      if (!pid) pid = await createProject(newDeckName);
      const selectedName = existingDecks.find((deck) => deck.id === pid)?.name;
      const effectiveDeckName = (deckName ?? "").trim() || selectedName || newDeckName;

      if (payload.mode === "topic") {
        // Topic decks have no stored source; generation starts right away.
        const taskId = startDeckGeneration({
          projectId: pid,
          deckName: effectiveDeckName,
          settings,
          sourceMode: "topic",
          topicQuery: payload.topic,
          file: null,
        });
        setActiveTaskId(taskId);
        return;
      }

      const base = {
        projectId: pid,
        deckName: effectiveDeckName,
        settings,
        // One-shot add + generate when requested from the overlay; otherwise
        // just persist the source and let the user generate later.
        generate: options.generate,
      };
      const taskId =
        payload.mode === "text"
          ? startDeckGeneration({
              ...base,
              sourceMode: "text",
              text: payload.text,
              file: null,
            })
          : payload.mode === "document"
            ? startDeckGeneration({
                ...base,
                sourceMode: "document",
                file: payload.file,
                extractImages: payload.extractImages,
              })
            : payload.mode === "video-upload"
              ? startDeckGeneration({
                  ...base,
                  sourceMode: "video",
                  videoInputMode: "upload",
                  file: payload.file,
                })
              : payload.mode === "youtube"
                ? startDeckGeneration({
                    ...base,
                    sourceMode: "video",
                    videoInputMode: "youtube",
                    youtubeUrl: payload.url,
                    file: null,
                  })
                : payload.mode === "website"
                  ? startDeckGeneration({
                      ...base,
                      sourceMode: "website",
                      websiteUrl: payload.url,
                      file: null,
                    })
                  : payload.mode === "google-drive"
                    ? startDeckGeneration({
                        ...base,
                        sourceMode: "google-drive",
                        googleDriveFileId: payload.file.id,
                        googleDriveFileName: payload.file.name,
                        file: null,
                      })
                    : startDeckGeneration({
                        ...base,
                        sourceMode: "notion",
                        notionPageId: payload.page.id,
                        notionPageTitle: payload.page.title,
                        file: null,
                      });
      setActiveTaskId(taskId);
    },
    [
      projectId,
      createProject,
      activateExistingDeck,
      existingDecks,
      router,
      deckName,
      settings,
      startDeckGeneration,
    ],
  );

  function handleGenerateClick() {
    setError(null);
    if (!projectId || sources.length === 0) {
      setAddSourceOpen(true);
      return;
    }
    if (textCardTypes.length === 0) {
      setError("Select at least one card type to generate.");
      return;
    }
    const taskId = startMultiSourceGeneration({
      projectId,
      deckName: topbarDeckLabel,
      settings,
      sources: sources.map((source) => ({ id: source.id, title: source.title })),
    });
    setActiveTaskId(taskId);
  }

  const handleCardSaved = useCallback((updated: OverlayCard) => {
    // The overlay owns the PUT (auto-save); we just sync the list row in place.
    setCards((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }, []);

  const handleGenerateFromSelection = useCallback(
    (selectedText: string) => {
      if (!activeSource || !projectId) {
        setError("Open a deck with a source document before generating from a selection.");
        return;
      }
      if (generating) return;
      const trimmed = selectedText.trim();
      if (trimmed.length < 20) {
        setError("Select at least 20 characters to generate flashcards.");
        return;
      }
      if (textCardTypes.length === 0) {
        setError("Select at least one card type (Front/Back or Fill-in-the-Blank) first.");
        return;
      }
      setError(null);
      const taskId = startDeckGeneration({
        projectId,
        deckName: (deckName ?? "").trim() || topbarDeckLabel,
        settings,
        existingSourceId: activeSource.id,
        scopeText: trimmed,
        sourceMode: "document",
        file: null,
      });
      setActiveTaskId(taskId);
    },
    [
      activeSource,
      projectId,
      generating,
      textCardTypes.length,
      startDeckGeneration,
      deckName,
      topbarDeckLabel,
      settings,
    ],
  );

  const removeCardsLocally = useCallback((ids: Set<string>) => {
    setCards((prev) => prev.filter((c) => !ids.has(c.id)));
    setTotalCards((prev) => Math.max(0, prev - ids.size));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    for (const id of ids) assistantSnapshotRef.current.delete(id);
    setRegenNotice((current) => (current && ids.has(current.id) ? null : current));
  }, []);

  const deleteCardById = useCallback(
    async (targetId: string, opts: { confirm?: boolean } = {}) => {
      if (opts.confirm && !window.confirm("Delete this card? This cannot be undone.")) return;
      setSaving(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/cards/${targetId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error(await res.text());
        removeCardsLocally(new Set([targetId]));
        if (focusedId === targetId) {
          setOverlayOpen(false);
          setFocusedId(null);
        }
      } catch (err) {
        setError(friendlyError(err, "Failed to delete card"));
      } finally {
        setSaving(false);
      }
    },
    [focusedId, removeCardsLocally],
  );

  /** Overlay delete button: acts on the focused card. */
  async function deleteCard() {
    if (!focused) return;
    await deleteCardById(focused.id);
  }

  const deleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "this card" : `${ids.length} cards`;
    if (!window.confirm(`Delete ${noun}? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/browse/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", card_ids: ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      const removed = new Set(ids);
      removeCardsLocally(removed);
      if (focusedId && removed.has(focusedId)) {
        setOverlayOpen(false);
        setFocusedId(null);
      }
    } catch (err) {
      setError(friendlyError(err, "Failed to delete cards"));
    } finally {
      setSaving(false);
    }
  }, [focusedId, removeCardsLocally, selectedIds]);

  // --- Card assistant -------------------------------------------------------

  const assistantScope = useMemo<CardAssistantScope>(() => {
    if (assistantCardId) {
      const card = cards.find((c) => c.id === assistantCardId);
      if (card) return { kind: "card", count: 1, preview: cardScopePreview(card) };
    }
    if (selectedIds.size > 0) return { kind: "selection", count: selectedIds.size };
    return { kind: "all", count: projectId ? totalCards : cards.length };
  }, [assistantCardId, cards, projectId, selectedIds.size, totalCards]);

  const assistantStatusRef = useRef<CardAssistantStatus>("idle");
  useEffect(() => {
    assistantStatusRef.current = assistantStatus;
  }, [assistantStatus]);

  const openAssistant = useCallback(
    (cardId: string | null, placement: CardAssistantPlacement, anchor?: HTMLElement | null) => {
      setAssistantCardId(cardId);
      setAssistantPlacement(placement);
      setAssistantAnchorEl(anchor ?? null);
      setAssistantOpen(true);
      if (anchor && placement === "card") {
        anchor.closest(".dh-create-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      // Reopening after a failure starts clean rather than showing the stale error.
      if (assistantStatusRef.current === "error") {
        setAssistantStatus("idle");
        setAssistantError(null);
      }
    },
    [],
  );

  const handleAssistantOpenChange = useCallback((open: boolean) => {
    setAssistantOpen(open);
    if (!open) {
      setAssistantCardId(null);
      setAssistantAnchorEl(null);
      setAssistantPlacement("fab");
    } else {
      setAssistantPlacement("fab");
      setAssistantCardId(null);
      setAssistantAnchorEl(null);
    }
  }, []);

  const dismissAssistantResult = useCallback(() => {
    setAssistantStatus("idle");
    setAssistantResult(null);
    setAssistantError(null);
  }, []);

  const runAssistant = useCallback(
    async (instruction: string) => {
      if (!projectId || assistantStatus === "running") return;
      const scopeIds: string[] | undefined = assistantCardId
        ? [assistantCardId]
        : selectedIds.size > 0
          ? [...selectedIds]
          : undefined;

      // Snapshot the loaded cards in scope so Undo can restore them. Cards not
      // yet paginated in are covered when the response arrives (see below).
      const inScope = scopeIds
        ? cardsRef.current.filter((c) => scopeIds.includes(c.id))
        : cardsRef.current;
      const snapshot = new Map<string, AssistantSnapshot>();
      for (const card of inScope) snapshot.set(card.id, snapshotOf(card));

      setAssistantStatus("running");
      setAssistantResult(null);
      setAssistantError(null);
      setPulseIds(new Set(inScope.map((c) => c.id)));
      setError(null);

      try {
        const result = await assistantEditCardsApi({
          deck_id: projectId,
          card_ids: scopeIds,
          instruction,
        });

        const updatedById = new Map(result.updated.map((row) => [row.id, row]));
        // Only keep snapshots for cards that actually changed.
        const undoSnapshot = new Map<string, AssistantSnapshot>();
        for (const [id, snap] of snapshot) {
          if (updatedById.has(id)) undoSnapshot.set(id, snap);
        }
        assistantSnapshotRef.current = undoSnapshot;

        setCards((prev) =>
          prev.map((card) => {
            const row = updatedById.get(card.id);
            if (!row) return card;
            return {
              ...card,
              front: row.front,
              back: row.back,
              cloze_text: row.cloze_text,
              extra: row.extra,
              tags: row.tags,
              user_edited: row.user_edited,
              updated_at: row.updated_at,
            };
          }),
        );
        if (result.updated.length > 0) {
          flashCardIds(result.updated.map((row) => row.id));
        }
        posthog.capture("card_assistant_edit", {
          deck_id: projectId,
          scope: assistantCardId ? "card" : scopeIds ? "selection" : "all",
          in_scope: result.scope,
          updated: result.updated.length,
        });
        setAssistantResult({
          updated: result.updated.length,
          scope: result.scope,
          summary: result.summary?.trim() ?? "",
          canUndo: undoSnapshot.size > 0,
        });
        setAssistantStatus("done");
      } catch (err) {
        const message = friendlyError(err, "The assistant could not edit these cards.");
        setAssistantError(
          isAiCreditsExhaustedMessage(message) ? AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE : message,
        );
        if (isAiCreditsExhaustedMessage(message)) setError(message);
        setAssistantStatus("error");
      } finally {
        setPulseIds(new Set());
      }
    },
    [assistantCardId, assistantStatus, flashCardIds, projectId, selectedIds],
  );

  const undoAssistant = useCallback(async () => {
    const snapshot = assistantSnapshotRef.current;
    if (snapshot.size === 0 || assistantUndoing) return;
    setAssistantUndoing(true);
    setError(null);
    const restored: string[] = [];
    const failed: string[] = [];
    const entries = [...snapshot.entries()];
    const CHUNK = 8;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await Promise.all(
        entries.slice(i, i + CHUNK).map(async ([id, snap]) => {
          try {
            await updateCardApi(id, {
              front: snap.front,
              back: snap.back,
              cloze_text: snap.cloze_text,
              extra: snap.extra,
              tags: snap.tags,
            });
            restored.push(id);
          } catch {
            failed.push(id);
          }
        }),
      );
    }
    const restoredSet = new Set(restored);
    setCards((prev) =>
      prev.map((card) => {
        if (!restoredSet.has(card.id)) return card;
        const snap = snapshot.get(card.id)!;
        return { ...card, ...snap, tags: [...snap.tags] };
      }),
    );
    if (restored.length > 0) flashCardIds(restored);
    assistantSnapshotRef.current = new Map();
    setAssistantUndoing(false);
    if (failed.length > 0) {
      setError(
        `Restored ${restored.length} of ${entries.length} cards — ${failed.length} could not be reverted.`,
      );
    }
    setAssistantResult((prev) =>
      prev
        ? {
            ...prev,
            canUndo: false,
            summary: `Reverted ${restored.length} ${restored.length === 1 ? "card" : "cards"}.`,
          }
        : prev,
    );
  }, [assistantUndoing, flashCardIds]);

  const showRegenNotice = useCallback((notice: typeof regenNotice) => {
    if (regenNoticeTimerRef.current) window.clearTimeout(regenNoticeTimerRef.current);
    setRegenNotice(notice);
    if (notice) {
      regenNoticeTimerRef.current = window.setTimeout(() => {
        setRegenNotice((current) => (current?.id === notice.id ? null : current));
        regenNoticeTimerRef.current = null;
      }, 12_000);
    }
  }, []);

  /**
   * Tile-level one-click rewrites: turn the card into an AnKing-style mnemonic
   * card, or regenerate it from its source. Both keep the card type and replace
   * its content fields; the previous content is kept briefly for Undo.
   */
  const runCardAction = useCallback(
    async (id: string, action: CardAiAction) => {
      const card = cardsRef.current.find((c) => c.id === id);
      if (!card || cardActionBusy.has(id)) return;
      setCardActionBusy((prev) => new Map(prev).set(id, action));
      setError(null);
      try {
        const previous = snapshotOf(card);
        const res =
          action === "mnemonic" ? await generateCardMnemonicApi(id) : await regenerateCardApi(id);
        setCards((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  front: res.front,
                  back: res.back,
                  cloze_text: res.cloze_text,
                  extra: res.extra,
                  user_edited: true,
                  updated_at: res.updated_at,
                }
              : c,
          ),
        );
        showRegenNotice({ id, action, previous });
        posthog.capture(action === "mnemonic" ? "card_mnemonic_rewritten" : "card_regenerated", {
          deck_id: projectId,
          card_type: card.type,
          surface: "create-tile",
        });
        flashCardIds([id]);
      } catch (err) {
        setError(
          friendlyError(
            err,
            action === "mnemonic"
              ? "Could not turn this card into a mnemonic card."
              : "Could not regenerate the card.",
          ),
        );
      } finally {
        setCardActionBusy((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [cardActionBusy, flashCardIds, projectId, showRegenNotice],
  );

  const undoRegenerate = useCallback(async () => {
    if (!regenNotice) return;
    const { id, previous } = regenNotice;
    showRegenNotice(null);
    // Optimistic restore; the PUT confirms it.
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...previous, tags: [...previous.tags] } : c)));
    try {
      await updateCardApi(id, {
        front: previous.front,
        back: previous.back,
        cloze_text: previous.cloze_text,
        extra: previous.extra,
      });
      flashCardIds([id]);
    } catch (err) {
      setError(friendlyError(err, "Could not undo the rewrite."));
    }
  }, [flashCardIds, regenNotice, showRegenNotice]);

  /** Ensure a deck exists (creating one if needed) before adding a manual card. */
  const ensureProjectId = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;
    const name = (deckName ?? "").trim() || "New deck";
    return createProject(name);
  }, [projectId, deckName, createProject]);

  const createCardFrom = useCallback(
    async (
      pid: string,
      payload: Record<string, unknown>,
      options: { openEditor?: boolean } = {},
    ) => {
      const res = await apiFetch("/api/cards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid, ...payload }),
      });
      const card = await readJson<Parameters<typeof apiCardToDraft>[0]>(res);
      const draft = apiCardToDraft(card);
      const prepend = payload.append === false;
      setCards((prev) => {
        if (prev.some((c) => c.id === draft.id)) return prev;
        return prepend ? [draft, ...prev] : [...prev, draft];
      });
      setTotalCards((n) => n + 1);
      flashCardIds([draft.id]);
      setFocusedId(draft.id);
      // Blank cards open straight into the editor; fully composed ones just
      // land in the list.
      if (options.openEditor !== false) setOverlayOpen(true);
      scrollCardIntoView(draft.id);
    },
    [flashCardIds, scrollCardIntoView],
  );

  async function writeManualCard(type: CardType = "basic") {
    setError(null);
    try {
      const pid = await ensureProjectId();
      const payload =
        type === "cloze"
          ? { type, cloze_text: "", extra: "", tags: [] as string[], append: false }
          : type === "image-occlusion"
            ? { type, front: "", back: "", tags: [] as string[], append: false }
            : { type: "basic" as const, front: "", back: "", tags: [] as string[], append: false };
      await createCardFrom(pid, payload);
    } catch (err) {
      setError(friendlyError(err, "Could not add a card"));
    }
  }

  const beginSourceImageOcclusion = useCallback(
    (selection: SourceImageSelection) => {
      if (!activeSource) return;
      setError(null);
      setSourceImageOcclusionTarget({
        sourceId: activeSource.id,
        imageUrl: selection.imageUrl,
        sourceRef: selection.sourceRef,
      });
    },
    [activeSource],
  );

  const createSourceImageOcclusionCard = useCallback(
    async ({
      front,
      occlusionData,
      sourceId,
      sourceRef,
    }: {
      front: string;
      occlusionData: ImageOcclusionData;
      sourceId: string;
      sourceRef: string | null;
    }) => {
      const pid = await ensureProjectId();
      await createCardFrom(pid, {
        type: "image-occlusion",
        front,
        back: "",
        occlusion_data: occlusionData,
        source_id: sourceId,
        source_ref: sourceRef,
        tags: [],
      });
    },
    [createCardFrom, ensureProjectId],
  );

  const handleViewSource = useCallback(
    (target: { sourceId: string; snippet: string }) => {
      const sourceId = target.sourceId?.trim();
      if (!sourceId) return;
      setActiveSourceId(sourceId);
      void prefetchSourceDocument(sourceId);
      setViewTab("notes");
      const text = (target.snippet ?? "").trim();
      if (text) {
        setSourceScrollTarget({ text, nonce: Date.now() });
      }
    },
    [],
  );

  const hasMoreCards = Boolean(projectId) && cards.length < totalCards;

  useEffect(() => {
    const root = listScrollRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !hasMoreCards || cardsLoading || loadingMoreCards) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && projectId) {
          void loadDeckCards(projectId, true);
        }
      },
      { root, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreCards, cardsLoading, loadingMoreCards, loadDeckCards, projectId, cards.length]);

  // Restore the persisted source/cards split once mounted (avoids relying on
  // localStorage during the initial render).
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= SPLIT_MIN_PCT && stored <= SPLIT_MAX_PCT) {
        setSourcePanePct(stored);
      }
    } catch {
      // Ignore storage access issues (private mode, etc.).
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HIGHLIGHTS_STORAGE_KEY);
      if (stored === "0" || stored === "false") setShowCardHighlights(false);
      else if (stored === "1" || stored === "true") setShowCardHighlights(true);
    } catch {
      // Ignore storage access issues (private mode, etc.).
    }
  }, []);

  const setShowCardHighlightsPersisted = useCallback((next: boolean) => {
    setShowCardHighlights(next);
    try {
      window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access issues.
    }
  }, []);

  const handleSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; move/up handlers still work without it.
    }
    setSplitDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleSplitPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!splitDragging || !splitBodyRef.current) return;
      const rect = splitBodyRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSourcePanePct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)));
    },
    [splitDragging],
  );

  const endSplitDrag = useCallback(() => {
    if (!splitDragging) return;
    setSplitDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setSourcePanePct((pct) => {
      try {
        window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(pct * 10) / 10));
      } catch {
        // Ignore storage access issues.
      }
      return pct;
    });
  }, [splitDragging]);

  const resetSplit = useCallback(() => {
    setSourcePanePct(SPLIT_DEFAULT_PCT);
    try {
      window.localStorage.removeItem(SPLIT_STORAGE_KEY);
    } catch {
      // Ignore storage access issues.
    }
  }, []);

  const originalAvailable = activeSource ? sourceHasOriginal(activeSource) : false;
  const effectiveTab: SourceViewTab =
    viewTab === "original" && originalAvailable ? "original" : "notes";

  /** Sources dropdown at the top-left of the source pane: hover peeks, click pins. */
  const sourcesFlyoutButton = (
    <SourcesFlyout
      sources={sources}
      activeSourceId={activeSourceId}
      disabled={generating}
      onSelect={(sourceId) => {
        setActiveSourceId(sourceId);
        void prefetchSourceDocument(sourceId);
      }}
      onAddSource={() => setAddSourceOpen(true)}
      onDeleteSource={async (sourceId) => {
        if (!projectId) return;
        await deleteSourceApi(sourceId);
        await Promise.all([
          loadProjectSources(projectId),
          loadDeckCards(projectId, { soft: true }),
        ]);
      }}
    />
  );

  return (
    <div style={s.shell}>
      <PageHeaderSlot menuItems={headerMenuItems} />

      <header style={top.bar} className="create-topbar">
        <div style={top.deckCluster}>
          <DeckSwitcher
            decks={existingDecks}
            currentId={projectId}
            label={topbarDeckLabel}
            disabled={decksLoading || generating}
            onSelect={(value) => void handleDeckChange(value)}
          />
          {projectId ? (
            <DeckActionsMenu
              deck={{
                id: projectId,
                title: topbarDeckLabel,
                cardCount: totalCards,
              }}
              omit={["create"]}
              variant="create-topbar"
              align="left"
              onRenamed={(name) => {
                setDeckName(name);
                setExistingDecks((prev) =>
                  prev.map((deck) => (deck.id === projectId ? { ...deck, name } : deck)),
                );
              }}
              onDuplicated={(copy) => {
                const nextDecks = [
                  { id: copy.id, name: copy.name },
                  ...existingDecks.filter((d) => d.id !== copy.id),
                ];
                setExistingDecks(nextDecks);
                void activateExistingDeck(copy.id, nextDecks);
              }}
              onDeleted={(deletedId) => {
                setExistingDecks((prev) => prev.filter((d) => d.id !== deletedId));
                startNewDeck();
              }}
              onPublish={(deckId) => router.push(`/decks/${deckId}`)}
            />
          ) : null}
        </div>
        <div style={top.right}>
          <TopbarPopover
            icon="ri-contrast-drop-2-line"
            label="Detail"
            value={detailLevelLabel(detailLevel)}
            disabled={generating}
          >
            {(close) => (
              <>
                {DETAIL_LEVEL_OPTIONS.map((option) => {
                  const selected = detailLevel === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`dh-menu-item${selected ? " is-active" : ""}`}
                      onClick={() => {
                        setDetailLevel(option.value);
                        close();
                      }}
                    >
                      <span style={top.menuOptionText}>
                        <span className="dh-menu-item__label">{option.label}</span>
                        <span style={top.menuOptionDesc}>
                          {DETAIL_PILL_DESCRIPTIONS[option.value]}
                        </span>
                      </span>
                      {selected ? <i className="ri-check-line dh-menu-item__check" aria-hidden /> : null}
                    </button>
                  );
                })}
              </>
            )}
          </TopbarPopover>
          <TopbarPopover
            icon="ri-stack-line"
            label="Type"
            value={typePillValue}
            disabled={generating}
            width={280}
          >
            {() => (
              <>
                {GENERATION_CARD_TYPE_OPTIONS.map((option) => {
                  const selected = selectedTypes.has(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={selected}
                      className="dh-menu-item"
                      onClick={() => toggleCardType(option.value)}
                    >
                      <i className={`${option.icon} dh-menu-item__icon`} aria-hidden />
                      <span className="dh-menu-item__label">{option.label}</span>
                      <span
                        style={{ ...top.menuCheckbox, ...(selected ? top.menuCheckboxOn : {}) }}
                        aria-hidden
                      >
                        {selected ? <i className="ri-check-line" /> : null}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </TopbarPopover>
          <TopbarPopover
            icon="ri-focus-3-line"
            label="Focus"
            value={focusPresetOption(focusPreset).label}
            disabled={generating}
            width={320}
          >
            {(close) => (
              <>
                {FOCUS_PRESET_OPTIONS.map((option) => {
                  const selected = focusPreset === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`dh-menu-item${selected ? " is-active" : ""}`}
                      onClick={() => {
                        setFocusPreset(option.value);
                        close();
                      }}
                    >
                      <span style={top.menuOptionText}>
                        <span className="dh-menu-item__label">{option.label}</span>
                        <span style={top.menuOptionDesc}>{option.description}</span>
                      </span>
                      {selected ? <i className="ri-check-line dh-menu-item__check" aria-hidden /> : null}
                    </button>
                  );
                })}
              </>
            )}
          </TopbarPopover>
          <CreateSettingsMenu
            disabled={generating}
            showCardHighlights={showCardHighlights}
            onShowCardHighlightsChange={setShowCardHighlightsPersisted}
            autoTags={autoTags}
            onAutoTagsChange={setAutoTags}
            clozeHints={clozeHints}
            onClozeHintsChange={setClozeHints}
          />
        </div>
      </header>

      <div
        ref={splitBodyRef}
        style={{
          ...top.body,
          gridTemplateColumns: `minmax(280px, ${sourcePanePct}fr) 14px minmax(300px, ${
            100 - sourcePanePct
          }fr)`,
        }}
      >
        <aside style={s.sourcePane}>
          {error ? (
            <div style={s.sourceError} role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              <span style={{ flex: 1, minWidth: 0 }}>
                {isAiCreditsExhaustedMessage(error)
                  ? AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE
                  : error}
              </span>
              {isAiCreditsExhaustedMessage(error) ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openSettings("billing")}
                >
                  View billing
                </button>
              ) : null}
              <button
                type="button"
                style={s.sourceErrorClose}
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                <i className="ri-close-line" />
              </button>
            </div>
          ) : null}
          {activeSource ? (
            <>
              <div style={s.viewerHeader}>
                <div style={s.viewerHeaderLeft}>
                  {sourcesFlyoutButton}
                  <div style={tab.wrap}>
                    <button
                      type="button"
                      onClick={() => setViewTab("notes")}
                      style={{ ...tab.btn, ...(effectiveTab === "notes" ? tab.btnActive : {}) }}
                    >
                      <i className="ri-edit-2-line" aria-hidden />
                      Text
                    </button>
                    {originalAvailable ? (
                      <button
                        type="button"
                        onClick={() => setViewTab("original")}
                        style={{
                          ...tab.btn,
                          ...(effectiveTab === "original" ? tab.btnActive : {}),
                        }}
                      >
                        <i className="ri-file-3-line" aria-hidden />
                        Original
                      </button>
                    ) : null}
                    {activeSource.externalUrl ? (
                      <a
                        href={activeSource.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={tab.btn}
                      >
                        <i className="ri-external-link-line" aria-hidden />
                        Original
                      </a>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="create-topbar-control create-topbar-control--primary"
                  onClick={handleGenerateClick}
                  disabled={generating || sourceTaskRunning}
                  title={
                    sourceTaskRunning
                      ? "Wait for the source to finish processing."
                      : undefined
                  }
                >
                  <i
                    className={`create-topbar-control__icon ${generating ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-line"}`}
                    aria-hidden
                  />
                  {generating ? "Generating…" : "Generate"}
                </button>
              </div>
              {effectiveTab === "original" ? (
                <SourceFileViewer
                  key={activeSource.id}
                  sourceId={activeSource.id}
                  sourceType={activeSource.type}
                />
              ) : (
                <SourceDocumentEditor
                  key={activeSource.id}
                  sourceId={activeSource.id}
                  showToolbar={false}
                  scrollTarget={sourceScrollTarget}
                  cardLinks={cardLinks}
                  activeCardId={overlayOpen ? focusedId : null}
                  onCardLinkClick={(cardId) => {
                    setFocusedId(cardId);
                    setOverlayOpen(true);
                  }}
                  onGenerateFromSelection={handleGenerateFromSelection}
                  generateFromSelectionDisabled={generating}
                  onCreateOcclusionFromImage={beginSourceImageOcclusion}
                  createOcclusionDisabled={generating || sourceTaskRunning}
                />
              )}
            </>
          ) : (
            <>
              <div style={s.viewerHeader}>{sourcesFlyoutButton}</div>
              <div style={s.sourceEmpty}>
                <div style={s.emptyAnchor}>
                  <div style={s.emptyMain}>
                    <i
                      className={
                        sourceTaskRunning ? "ri-loader-4-line icon-spin" : "ri-file-text-line"
                      }
                      style={s.emptyIcon}
                      aria-hidden
                    />
                    <p style={s.emptyText}>
                      {sourceTaskRunning
                        ? "Your source is being processed — it will appear here shortly."
                        : "Your sources and original documents will show up here."}
                    </p>
                  </div>
                  {!sourceTaskRunning ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={s.emptyAction}
                      onClick={() => setAddSourceOpen(true)}
                    >
                      <i className="ri-add-line" aria-hidden />
                      Add source
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize source and cards panes"
          title="Drag to resize — double-click to reset"
          style={top.splitter}
          onPointerDown={handleSplitPointerDown}
          onPointerMove={handleSplitPointerMove}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
          onDoubleClick={resetSplit}
        >
          <span
            style={{
              ...top.splitterBar,
              ...(splitDragging ? top.splitterBarActive : {}),
            }}
          />
        </div>

        <section style={s.cardsPane}>
          <div ref={listPaneRef} style={s.listPane}>
            <CreateCardsPane
              cards={cards}
              totalCards={totalCards}
              projectId={projectId}
              cardsLoading={cardsLoading}
              cardsRefreshing={cardsRefreshing}
              loadingMoreCards={loadingMoreCards}
              hasMoreCards={hasMoreCards}
              busy={generating || saving || assistantStatus === "running"}
              focusedId={focusedId}
              overlayOpen={overlayOpen}
              flashIds={flashIds}
              pulseIds={pulseIds}
              actionBusy={cardActionBusy}
              rewriteNotice={regenNotice ? { id: regenNotice.id, action: regenNotice.action } : null}
              selectedIds={selectedIds}
              assistantOpen={assistantOpen}
              assistantPlacement={assistantPlacement}
              listScrollRef={listScrollRef}
              loadMoreRef={loadMoreRef}
              cardRowRefs={cardRowRefs}
              onSelectionChange={setSelectedIds}
              onOpenCard={(id) => {
                setFocusedId(id);
                setOverlayOpen(true);
              }}
              onCreateCard={(type) => void writeManualCard(type)}
              onDeleteCard={(id) => void deleteCardById(id, { confirm: true })}
              onDeleteSelected={() => void deleteSelected()}
              onAssistCard={(id, el) => openAssistant(id, "card", el)}
              onGenerateMnemonic={(id) => void runCardAction(id, "mnemonic")}
              onRegenerateCard={(id) => void runCardAction(id, "regenerate")}
              onUndoRewrite={() => void undoRegenerate()}
              onDismissRewriteNotice={() => showRegenNotice(null)}
              onOpenAssistant={(el) => openAssistant(null, "header", el)}
            />
            <CardAssistantBar
              open={assistantOpen}
              hidden={!projectId || (cards.length === 0 && !cardsRefreshing)}
              disabled={generating || cardsLoading}
              scope={assistantScope}
              status={assistantStatus}
              result={assistantResult}
              error={assistantError}
              undoing={assistantUndoing}
              placement={assistantPlacement}
              anchorEl={assistantAnchorEl}
              containerRef={listPaneRef}
              onOpenChange={handleAssistantOpenChange}
              onSubmit={(instruction) => void runAssistant(instruction)}
              onUndo={() => void undoAssistant()}
              onDismissResult={dismissAssistantResult}
            />
          </div>
        </section>
      </div>

      <AddSourceOverlay
        open={addSourceOpen}
        projectId={projectId}
        decks={existingDecks}
        disabled={generating}
        detailLevel={detailLevel}
        onDetailLevelChange={setDetailLevel}
        selectedTypes={selectedTypes}
        onToggleCardType={toggleCardType}
        focusPreset={focusPreset}
        onFocusPresetChange={setFocusPreset}
        onClose={() => setAddSourceOpen(false)}
        onSubmit={handleAddSourceSubmit}
        onImportApkg={() => openDeckImport("anki")}
        onImportQuizlet={() => openDeckImport("quizlet")}
        showCardHighlights={showCardHighlights}
        onShowCardHighlightsChange={setShowCardHighlightsPersisted}
        autoTags={autoTags}
        onAutoTagsChange={setAutoTags}
        clozeHints={clozeHints}
        onClozeHintsChange={setClozeHints}
      />

      <CardEditOverlay
        open={overlayOpen && Boolean(focused)}
        card={focused ? draftToOverlayCard(focused) : null}
        deckName={(deckName ?? "").trim() || "New deck"}
        cardIndex={focused ? cards.findIndex((c) => c.id === focused.id) : -1}
        busy={generating || cardsLoading || saving}
        onClose={() => setOverlayOpen(false)}
        onSaved={handleCardSaved}
        onDelete={cards.length > 0 ? deleteCard : undefined}
        onViewSource={handleViewSource}
        allowUnlinkSource
      />

      {sourceImageOcclusionTarget ? (
        <SourceImageOcclusionDialog
          target={sourceImageOcclusionTarget}
          disabled={generating}
          onClose={() => setSourceImageOcclusionTarget(null)}
          onCreate={createSourceImageOcclusionCard}
        />
      ) : null}

      <AnkiImportOverlay
        open={deckImportOpen}
        initialMode={deckImportMode}
        onClose={() => setDeckImportOpen(false)}
      />

    </div>
  );
}

const tab = {
  wrap: {
    display: "inline-flex",
    alignItems: "center",
    padding: 2,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    gap: 2,
    flexWrap: "wrap" as const,
    boxSizing: "border-box" as const,
    minHeight: 32,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    padding: "0 10px",
    background: "transparent",
    color: "var(--ink-500)",
    border: "1px solid transparent",
    borderRadius: 6,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  btnActive: {
    background: "var(--white)",
    color: "var(--ink-900)",
    border: "1px solid var(--border-secondary)",
  } as React.CSSProperties,
};

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flex: 1,
    minHeight: 0,
    height: "100%",
    // Match horizontal inset to the top/bottom padding — side gutter comes from
    // `.dh-app-main { scrollbar-gutter: stable both-edges }` (~14–16px each side).
    padding: "14px 0",
    boxSizing: "border-box",
  },
  sourcePane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  viewerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: 6,
    borderBottom: "1px solid var(--border-1)",
    flexShrink: 0,
    boxSizing: "border-box",
    height: 44,
    minHeight: 44,
    maxHeight: 44,
  },
  viewerHeaderLeft: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  sourceEmpty: {
    flex: 1,
    position: "relative",
    textAlign: "center",
  },
  // Every pane uses the same icon-top anchor. Keeping the action in normal
  // flow below this anchor lets copy wrap without ever being covered.
  emptyAnchor: {
    position: "absolute",
    top: "calc(50% - 44px)",
    left: 0,
    right: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 40px",
    boxSizing: "border-box",
    textAlign: "center",
  },
  emptyMain: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  emptyIcon: {
    fontSize: 36,
    lineHeight: 1,
    color: "var(--ink-300)",
    flexShrink: 0,
  },
  emptyAction: {
    marginTop: 12,
    flexShrink: 0,
  },
  sourceError: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    background: "var(--grade-again-bg)",
    borderBottom: "1px solid rgba(217, 45, 32, 0.32)",
    font: "500 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
    flexShrink: 0,
  },
  sourceErrorClose: {
    border: 0,
    background: "transparent",
    cursor: "pointer",
    color: "inherit",
    fontSize: 16,
    padding: 2,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
  },
  cardsPane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: 12,
  },
  listPane: {
    flex: 1,
    minHeight: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  emptyText: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
    maxWidth: 280,
    minHeight: 40,
  },
};

// --- Redesigned top bar + deck switcher ------------------------------------

const DETAIL_PILL_DESCRIPTIONS: Record<DetailLevel, string> = {
  low: "Fewer cards, only the highest-yield facts.",
  medium: "Balanced coverage of the material.",
  high: "Comprehensive — cover nearly everything.",
};

/** Checkbox-style row used inside the create settings overflow menu. */
function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="dh-menu-item"
      style={disabled ? top.menuItemDisabled : undefined}
      onClick={() => onChange(!checked)}
    >
      <i className={`${icon} dh-menu-item__icon`} aria-hidden />
      <span style={top.menuOptionText}>
        <span className="dh-menu-item__label">{label}</span>
        <span style={top.menuOptionDesc}>{description}</span>
      </span>
      <span
        style={{ ...top.menuCheckbox, ...(checked && !disabled ? top.menuCheckboxOn : {}) }}
        aria-hidden
      >
        {checked && !disabled ? <i className="ri-check-line" /> : null}
      </span>
    </button>
  );
}

/**
 * Create-page overflow (⋯) for secondary settings: highlights, tags, and cloze
 * hints. Image extraction is chosen per upload in the add-source overlay.
 */
function CreateSettingsMenu({
  disabled,
  showCardHighlights,
  onShowCardHighlightsChange,
  autoTags,
  onAutoTagsChange,
  clozeHints,
  onClozeHintsChange,
}: {
  disabled?: boolean;
  showCardHighlights: boolean;
  onShowCardHighlightsChange: (next: boolean) => void;
  autoTags: boolean;
  onAutoTagsChange: (next: boolean) => void;
  clozeHints: boolean;
  onClozeHintsChange: (next: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={top.pillRoot}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`create-topbar-control create-toolbar-pill create-settings-menu-btn${open ? " create-toolbar-pill--open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create settings"
        title="Settings"
      >
        <i className="ri-more-2-fill create-topbar-control__icon create-topbar-control__icon--muted" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Create settings"
          style={{ ...top.pillMenu, right: 0, width: 320 }}
        >
          <SettingsToggleRow
            icon="ri-mark-pen-line"
            label="Source highlights"
            description="Highlight passages linked to cards in the source."
            checked={showCardHighlights}
            onChange={onShowCardHighlightsChange}
          />
          <SettingsToggleRow
            icon="ri-price-tag-3-line"
            label="Auto tags"
            description="Tag new cards by topic and source."
            checked={autoTags}
            onChange={onAutoTagsChange}
          />
          <SettingsToggleRow
            icon="ri-lightbulb-line"
            label="Hints on blanks"
            description="Add hints to fill-in-the-blank cards when that type is enabled."
            checked={clozeHints}
            onChange={onClozeHintsChange}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Top-bar setting pill that opens an inline dropdown for adjusting that
 * setting in place. Children receive a `close` callback.
 */
function TopbarPopover({
  icon,
  label,
  value,
  disabled,
  width,
  children,
}: {
  icon: string;
  label: string;
  value: string;
  disabled?: boolean;
  width?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** Anchor side chosen at open time so the menu stays inside the viewport. */
  const [align, setAlign] = useState<"left" | "right">("right");
  const close = useCallback(() => setOpen(false), []);

  const toggleOpen = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect();
        const menuWidth = width ?? 230;
        setAlign(rect.right - menuWidth >= 8 ? "right" : "left");
      }
      return next;
    });
  }, [width]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={top.pillRoot}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`create-topbar-control create-toolbar-pill${open ? " create-toolbar-pill--open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
      >
        <i className={`${icon} create-topbar-control__icon create-topbar-control__icon--muted`} aria-hidden />
        <span className="create-topbar-control__label">
          {label}: <span className="create-toolbar-pill__value">{value}</span>
        </span>
        <i
          className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} create-topbar-control__caret`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`${label} setting`}
          style={{
            ...top.pillMenu,
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            ...(width ? { width } : {}),
          }}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

function DeckSwitcher({
  decks,
  currentId,
  label,
  disabled,
  onSelect,
}: {
  decks: DeckOption[];
  currentId: string | null;
  label: string;
  disabled?: boolean;
  onSelect: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={top.deckRoot}>
      <button
        type="button"
        className="create-topbar-control create-deck-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i
          className="ri-folder-3-line create-topbar-control__icon create-topbar-control__icon--accent"
          aria-hidden
        />
        <span className="create-topbar-control__label create-topbar-control__label--strong">{label}</span>
        <i
          className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} create-topbar-control__caret`}
          aria-hidden
        />
      </button>

      {open ? (
        <div role="menu" aria-label="Switch deck" style={top.deckMenu}>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-item"
            onClick={() => {
              setOpen(false);
              onSelect(NEW_DECK_VALUE);
            }}
          >
            <i className="ri-add-line dh-menu-item__icon" aria-hidden />
            <span className="dh-menu-item__label">Create new deck…</span>
          </button>

          {decks.length > 0 ? (
            <>
              <div style={top.deckDivider} />
              <div style={top.deckScroll}>
                {decks.map((deck) => (
                  <button
                    key={deck.id}
                    type="button"
                    role="menuitem"
                    className={`dh-menu-item${deck.id === currentId ? " is-active" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      onSelect(deck.id);
                    }}
                  >
                    <i className="ri-folder-3-line dh-menu-item__icon" aria-hidden />
                    <span className="dh-menu-item__label">{deck.name}</span>
                    {deck.id === currentId ? (
                      <i className="ri-check-line dh-menu-item__check" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const top: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    paddingBottom: 12,
    borderBottom: "1px solid var(--border-1)",
  },
  deckCluster: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  right: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pillRoot: {
    position: "relative",
    display: "inline-flex",
  },
  pillMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    zIndex: 50,
    minWidth: 230,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  menuOptionText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  menuOptionDesc: {
    font: "400 11px/15px var(--font-sans)",
    color: "var(--fg-4)",
    whiteSpace: "normal",
  },
  menuItemDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  menuCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    border: "1px solid var(--border-2)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    color: "var(--white)",
    background: "var(--white)",
    flexShrink: 0,
  },
  menuCheckboxOn: {
    background: "var(--teal-500)",
    border: "1px solid var(--teal-500)",
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    // Actual columns are set inline: source pane | drag divider | cards pane.
    gridTemplateColumns: "minmax(280px, 1fr) 14px minmax(300px, 1fr)",
  },
  splitter: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    cursor: "col-resize",
    touchAction: "none",
    padding: "0 5px",
  },
  splitterBar: {
    width: 4,
    borderRadius: 2,
    background: "var(--border-1)",
    transition: "background 120ms ease",
  },
  splitterBarActive: {
    background: "var(--teal-500)",
  },
  // Deck switcher
  deckRoot: {
    position: "relative",
    display: "inline-flex",
    minWidth: 0,
  },
  deckMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: 50,
    width: 320,
    maxWidth: "min(320px, 90vw)",
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    boxSizing: "border-box",
  },
  deckScroll: {
    maxHeight: 300,
    overflow: "auto",
  },
  deckDivider: {
    height: 1,
    background: "var(--border-1)",
    margin: "4px 0",
  },
};
