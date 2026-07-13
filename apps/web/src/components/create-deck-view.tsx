"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SOURCE_FILE_BYTES,
  MAX_VIDEO_BYTES,
  parseGenerationSettings,
  FOCUS_PRESET_OPTIONS,
  DEFAULT_FOCUS_PRESET,
  focusPresetOption,
  type FocusPreset,
  type CardMix,
  type DetailLevel,
  type DraftCard,
  type GenerationCardType,
  GENERATION_CARD_TYPE_OPTIONS,
  DETAIL_LEVEL_OPTIONS,
  detailLevelLabel,
  cardTypeChipClass,
  cardTypeLabel,
  type SourceType,
  type TopicSuggestion,
} from "@deephaus/shared";
import { AnkiImportOverlay } from "@/components/anki-import-overlay";
import { CardEditOverlay, type OverlayCard } from "@/components/card-edit-overlay";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { SourceDocumentEditor } from "@/components/source-document-editor";
import type { SourceCardLink } from "@/components/source-card-links";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";
import { useAiContext } from "@/lib/ai-assistant/context";
import { CardListSkeleton } from "@/components/ui/skeleton-patterns";
import { StudyCardTags } from "@/components/study-card-tags";
import { cardAnswerText, cardPreviewText, type BrowseCardRow } from "@/lib/browse/cards";
import {
  buildSourceChunks,
  formatSegmentLabel,
  toChunkPreviews,
  type SourceChunkPreview,
} from "@/lib/sources/chunks";
import {
  DOCUMENT_ACCEPT,
  VIDEO_ACCEPT,
  detectSourceFileKind,
  sourceTypeIconClass,
} from "@/lib/sources/file-types";
import { NotionPagePicker, type NotionPageSummary } from "@/components/notion-page-picker";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { parseYouTubeVideoId } from "@/lib/youtube/parse";
import { useBackgroundTasks } from "@/lib/background-tasks/context";
import "@/components/rich-text/rich-text.css";

type SourceMode = "text" | "document" | "video" | "topic" | "notion";
type VideoInputMode = "upload" | "youtube";
type ScopeMode = "all" | "segments";
type DeckOption = { id: string; name: string };

const NEW_DECK_VALUE = "__new__";
const CARD_PAGE_SIZE = 50;

function stripFileExtension(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(0, dot);
}

function truncateDeckTitle(text: string, max = 60): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function suggestDeckNameFromSource(input: {
  sourceMode: SourceMode;
  topicQuery: string;
  file: File | null;
  notionPage: NotionPageSummary | null;
  videoInputMode: VideoInputMode;
  text: string;
}): string {
  if (input.sourceMode === "topic") {
    return truncateDeckTitle(input.topicQuery) || "Topic deck";
  }
  if (input.sourceMode === "notion") {
    return input.notionPage?.title?.trim() || "Notion import";
  }
  if (input.sourceMode === "video" && input.videoInputMode === "youtube") {
    return "YouTube import";
  }
  if (input.file) {
    return stripFileExtension(input.file.name) || "Imported deck";
  }
  if (input.sourceMode === "text") {
    const firstLine = input.text.trim().split(/\n/)[0] ?? "";
    return truncateDeckTitle(firstLine) || "Text notes";
  }
  return "New deck";
}
const MAX_FILE_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);
const MAX_VIDEO_MB = MAX_VIDEO_BYTES / (1024 * 1024);

/** Source/cards split: percentage width of the source pane, persisted locally. */
const SPLIT_STORAGE_KEY = "dh-create-split-pct";
const SPLIT_MIN_PCT = 28;
const SPLIT_MAX_PCT = 72;
const SPLIT_DEFAULT_PCT = 50;

function truncate(text: string, max = 100) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    try {
      const json = JSON.parse(body) as { error?: string };
      throw new Error(json.error ?? body);
    } catch (e) {
      if (e instanceof Error && e.message !== body) throw e;
      throw new Error(body || `Request failed (${res.status})`);
    }
  }
  return JSON.parse(body) as T;
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

type Props = {
  initialDeckId?: string | null;
  initialAnkiImportOpen?: boolean;
};

export function CreateDeckView({
  initialDeckId = null,
  initialAnkiImportOpen = false,
}: Props) {
  const router = useRouter();
  const { tasks, getTaskForProject, startDeckGeneration } = useBackgroundTasks();
  const [deckName, setDeckName] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [debouncedYoutubeUrl, setDebouncedYoutubeUrl] = useState("");
  const [notionPage, setNotionPage] = useState<NotionPageSummary | null>(null);
  const [previewRawText, setPreviewRawText] = useState<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [chunks, setChunks] = useState<SourceChunkPreview[]>([]);
  const [selectedChunks, setSelectedChunks] = useState<Set<number>>(() => new Set());
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [selectedTypes, setSelectedTypes] = useState<Set<GenerationCardType>>(
    () => new Set<GenerationCardType>(["basic"]),
  );
  const [topicQuery, setTopicQuery] = useState("");
  const [selectedTopicSuggestionId, setSelectedTopicSuggestionId] = useState<string | null>(null);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestion[]>([]);
  const [topicSuggestionsLoading, setTopicSuggestionsLoading] = useState(false);
  const [focusPreset, setFocusPreset] = useState<FocusPreset>(DEFAULT_FOCUS_PRESET);
  const [clozeHints, setClozeHints] = useState(true);
  const [autoTags, setAutoTags] = useState(true);
  const [extractImages, setExtractImages] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [existingDecks, setExistingDecks] = useState<DeckOption[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [decksLoading, setDecksLoading] = useState(true);
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  /** The deck's stored source, shown as an editable document on the left. */
  const [currentSource, setCurrentSource] = useState<{ id: string; type: SourceType } | null>(null);
  /** When true, the upload/setup form replaces the source editor (add new source). */
  const [replaceSource, setReplaceSource] = useState(false);
  /** Drives "View in source": scrolls the left document to a card's snippet. */
  const [sourceScrollTarget, setSourceScrollTarget] = useState<{ text: string; nonce: number } | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const cardsLengthRef = useRef(0);
  const loadingMoreCardsRef = useRef(false);
  /** Width of the source pane as a % of the split body; draggable via divider. */
  const [sourcePanePct, setSourcePanePct] = useState(SPLIT_DEFAULT_PCT);
  const [splitDragging, setSplitDragging] = useState(false);
  const splitBodyRef = useRef<HTMLDivElement>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Collapses the setup pane to a slim rail; contents stay mounted so form state survives. */
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameModalUseAuto, setNameModalUseAuto] = useState(true);
  const [nameModalCustom, setNameModalCustom] = useState("");
  const [ankiImportOpen, setAnkiImportOpen] = useState(initialAnkiImportOpen);
  const lastSyncedTaskRef = useRef<string | null>(null);

  const openAnkiImport = useCallback(() => {
    setAnkiImportOpen(true);
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

  const generating = activeTask?.status === "running";

  const targetDeckValue =
    projectId && existingDecks.some((deck) => deck.id === projectId)
      ? projectId
      : NEW_DECK_VALUE;

  const headerMenuItems = useMemo<TopbarMenuItem[]>(() => {
    const items: TopbarMenuItem[] = [
      {
        id: "import-apkg",
        label: "Import .apkg",
        icon: "ri-folder-download-line",
        onClick: openAnkiImport,
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
  }, [projectId, openAnkiImport]);

  const focused = useMemo(
    () => cards.find((c) => c.id === focusedId) ?? null,
    [cards, focusedId],
  );

  /** Evidence quotes to highlight in the source document (source → card links). */
  const cardLinks = useMemo<SourceCardLink[]>(
    () =>
      cards
        .filter((c) => (c.source_quote ?? "").trim().length > 0)
        .map((c) => ({ cardId: c.id, quote: c.source_quote as string })),
    [cards],
  );

  const aiSourceText = (sourceMode === "topic" ? topicQuery : text || previewRawText || "").slice(
    0,
    8000,
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
    sourceText: aiSourceText || null,
  });

  const applyChunks = useCallback((next: SourceChunkPreview[]) => {
    setChunks(next);
    setSelectedChunks(new Set(next.map((c) => c.index)));
  }, []);

  useEffect(() => {
    cardsLengthRef.current = cards.length;
  }, [cards.length]);

  const loadDeckCards = useCallback(async (deckId: string, append = false) => {
    if (append) {
      if (loadingMoreCardsRef.current) return;
      loadingMoreCardsRef.current = true;
      setLoadingMoreCards(true);
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
      const res = await fetch(`/api/browse/cards?${params}`, { credentials: "include" });
      const data = await readJson<{ cards: BrowseCardRow[]; total: number }>(res);
      const nextCards = data.cards.map(browseRowToDraft);
      if (append) {
        setCards((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          return [...prev, ...nextCards.filter((c) => !existing.has(c.id))];
        });
      } else {
        setCards(nextCards);
      }
      setTotalCards(data.total);
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : "Could not load deck cards");
        setCards([]);
        setTotalCards(0);
      }
    } finally {
      if (append) {
        loadingMoreCardsRef.current = false;
        setLoadingMoreCards(false);
      } else {
        setCardsLoading(false);
      }
    }
  }, []);

  const loadProjectSource = useCallback(async (deckId: string) => {
    try {
      const res = await fetch(`/api/projects/${deckId}/source`, { credentials: "include" });
      const data = await readJson<{ source: { id: string; type: SourceType } | null }>(res);
      setCurrentSource(data.source ? { id: data.source.id, type: data.source.type } : null);
      setReplaceSource(false);
    } catch {
      setCurrentSource(null);
    }
  }, []);

  const activateExistingDeck = useCallback(
    async (deckId: string, decks: DeckOption[]) => {
      setProjectId(deckId);
      const deck = decks.find((d) => d.id === deckId);
      setDeckName(deck?.name ?? "");

      try {
        const projRes = await fetch(`/api/projects/${deckId}`, { credentials: "include" });
        const project = await readJson<{
          settings?: unknown;
          deck_name?: string | null;
          name?: string | null;
        }>(projRes);
        setDeckName(project.deck_name ?? project.name ?? "");
        const parsed = parseGenerationSettings(project.settings ?? {});
        setDetailLevel(parsed.detailLevel);
        const types = new Set<GenerationCardType>(parsed.cardTypes);
        if (parsed.autoImageOcclusion) types.add("image-occlusion");
        if (types.size === 0) types.add("basic");
        setSelectedTypes(types);
        setFocusPreset(parsed.focusPreset ?? DEFAULT_FOCUS_PRESET);
        setClozeHints(parsed.clozeHints);
        setAutoTags(parsed.autoTags);
      } catch {
        // Keep deck name from list if project fetch fails.
      }

      await Promise.all([loadDeckCards(deckId), loadProjectSource(deckId)]);
    },
    [loadDeckCards, loadProjectSource],
  );

  const startNewDeck = useCallback(() => {
    setProjectId(null);
    setDeckName("");
    setCards([]);
    setTotalCards(0);
    setFocusedId(null);
    setCurrentSource(null);
    setReplaceSource(false);
    setDetailLevel("medium");
    setSelectedTypes(new Set<GenerationCardType>(["basic"]));
    setTopicQuery("");
    setSelectedTopicSuggestionId(null);
    setFocusPreset(DEFAULT_FOCUS_PRESET);
    setClozeHints(true);
    setAutoTags(true);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDecksLoading(true);
      try {
        const res = await fetch("/api/projects", { credentials: "include" });
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
          setError(err instanceof Error ? err.message : "Could not load decks");
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

  async function handleDeckChange(value: string) {
    if (value === NEW_DECK_VALUE) {
      startNewDeck();
      return;
    }
    await activateExistingDeck(value, existingDecks);
  }

  useEffect(() => {
    if (sourceMode !== "text") return;
    const trimmed = text.trim();
    if (trimmed.length < 20) {
      setChunks([]);
      setSelectedChunks(new Set());
      return;
    }
    const timer = window.setTimeout(() => {
      const built = toChunkPreviews(buildSourceChunks("text", trimmed));
      applyChunks(built);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, sourceMode, applyChunks]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedYoutubeUrl(youtubeUrl.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [youtubeUrl]);

  useEffect(() => {
    if (sourceMode !== "document" && !(sourceMode === "video" && videoInputMode === "upload")) {
      return;
    }
    if (!file) {
      setChunks([]);
      setSelectedChunks(new Set());
      setPreviewRawText(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch("/api/sources/preview", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const data = await readJson<{
          chunks: SourceChunkPreview[];
          raw_text?: string;
        }>(res);
        if (!cancelled) {
          applyChunks(data.chunks);
          setPreviewRawText(data.raw_text ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not preview file");
          setChunks([]);
          setSelectedChunks(new Set());
          setPreviewRawText(null);
        }
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, sourceMode, videoInputMode, applyChunks]);

  useEffect(() => {
    if (sourceMode !== "video" || videoInputMode !== "youtube") return;
    if (!debouncedYoutubeUrl) {
      setChunks([]);
      setSelectedChunks(new Set());
      setPreviewRawText(null);
      return;
    }
    if (!parseYouTubeVideoId(debouncedYoutubeUrl)) {
      setChunks([]);
      setSelectedChunks(new Set());
      setPreviewRawText(null);
      setError("Enter a valid YouTube link (youtube.com/watch?v=… or youtu.be/…).");
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/sources/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "youtube", url: debouncedYoutubeUrl }),
        });
        const data = await readJson<{
          chunks: SourceChunkPreview[];
          raw_text?: string;
        }>(res);
        if (!cancelled) {
          applyChunks(data.chunks);
          setPreviewRawText(data.raw_text ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not fetch YouTube captions");
          setChunks([]);
          setSelectedChunks(new Set());
          setPreviewRawText(null);
        }
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedYoutubeUrl, sourceMode, videoInputMode, applyChunks]);

  useEffect(() => {
    if (sourceMode !== "notion") return;
    if (!notionPage) {
      setChunks([]);
      setSelectedChunks(new Set());
      setPreviewRawText(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/sources/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "notion", page_id: notionPage.id }),
        });
        const data = await readJson<{
          chunks: SourceChunkPreview[];
          raw_text?: string;
        }>(res);
        if (!cancelled) {
          applyChunks(data.chunks);
          setPreviewRawText(data.raw_text ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read the Notion page");
          setChunks([]);
          setSelectedChunks(new Set());
          setPreviewRawText(null);
        }
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [notionPage, sourceMode, applyChunks]);

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

  const chunkIndices = useMemo(() => {
    if (scopeMode === "all") return undefined;
    return [...selectedChunks].sort((a, b) => a - b);
  }, [scopeMode, selectedChunks]);

  const showSourceEditor = Boolean(currentSource) && !replaceSource;

  const occlusionAvailable =
    sourceMode === "document" ||
    (showSourceEditor &&
      (currentSource?.type === "pdf" ||
        currentSource?.type === "pptx" ||
        currentSource?.type === "docx"));

  // Drop image occlusion when the source can't carry images (text / video), so
  // the selection always reflects what will actually be generated.
  useEffect(() => {
    if (occlusionAvailable) return;
    setSelectedTypes((prev) => {
      if (!prev.has("image-occlusion")) return prev;
      const next = new Set(prev);
      next.delete("image-occlusion");
      if (next.size === 0) next.add("basic");
      return next;
    });
  }, [occlusionAvailable]);

  const textCardTypes = useMemo(
    () =>
      GENERATION_CARD_TYPE_OPTIONS.filter(
        (o) => o.value !== "image-occlusion" && selectedTypes.has(o.value),
      ).map((o) => o.value as CardMix),
    [selectedTypes],
  );

  const autoImageOcclusion = selectedTypes.has("image-occlusion") && occlusionAvailable;
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
      autoImageOcclusion,
      clozeHints: clozeSelected ? clozeHints : false,
      autoTags,
      detailLevel,
      focusPreset,
    }),
    [textCardTypes, autoImageOcclusion, clozeSelected, clozeHints, autoTags, detailLevel, focusPreset],
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

  const suggestedDeckName = useMemo(
    () =>
      suggestDeckNameFromSource({
        sourceMode,
        topicQuery,
        file,
        notionPage,
        videoInputMode,
        text,
      }),
    [sourceMode, topicQuery, file, notionPage, videoInputMode, text],
  );

  const getGeneratePrerequisitesError = useCallback((): string | null => {
    if (textCardTypes.length === 0 && !autoImageOcclusion) {
      return "Select at least one card type to generate.";
    }
    if (showSourceEditor && currentSource && projectId) {
      return null;
    }
    if (sourceMode === "topic") {
      if (topicQuery.trim().length < 3) {
        return "Enter a topic (at least 3 characters) or pick a suggestion.";
      }
      return null;
    }
    if (sourceMode === "text" && text.trim().length < 20) {
      return "Paste at least 20 characters of text.";
    }
    if (sourceMode === "document" || (sourceMode === "video" && videoInputMode === "upload")) {
      if (!file) {
        return sourceMode === "video" ? "Choose a video to upload." : "Choose a file to upload.";
      }
    } else if (sourceMode === "video" && videoInputMode === "youtube") {
      if (!parseYouTubeVideoId(youtubeUrl)) {
        return "Enter a valid YouTube link.";
      }
      if (!previewRawText) {
        return "Wait for YouTube captions to load before generating.";
      }
    } else if (sourceMode === "notion") {
      if (!notionPage) {
        return "Pick a Notion page to generate from.";
      }
      if (previewBusy) {
        return "Wait for the Notion page to finish loading.";
      }
    }
    if (file) {
      const kind = detectSourceFileKind(file.name, file.type);
      if (sourceMode === "document" && kind !== "document") {
        return "Choose a PDF, Word (.docx), or PowerPoint (.pptx) file.";
      }
      if (sourceMode === "video" && kind !== "video") {
        return "Choose a supported video file (MP4, WebM, MOV, etc.).";
      }
      const maxBytes = sourceMode === "video" ? MAX_VIDEO_BYTES : MAX_SOURCE_FILE_BYTES;
      const maxMb = sourceMode === "video" ? MAX_VIDEO_MB : MAX_FILE_MB;
      if (file.size > maxBytes) {
        return `File must be under ${maxMb} MB.`;
      }
    }
    if (scopeMode === "segments" && (!chunkIndices || chunkIndices.length === 0)) {
      return "Select at least one segment to generate from.";
    }
    if (chunks.length === 0) {
      return "Add source content with enough text to generate segments.";
    }
    return null;
  }, [
    autoImageOcclusion,
    chunkIndices,
    chunks.length,
    currentSource,
    file,
    notionPage,
    previewBusy,
    previewRawText,
    projectId,
    scopeMode,
    showSourceEditor,
    sourceMode,
    text,
    textCardTypes.length,
    topicQuery,
    videoInputMode,
    youtubeUrl,
  ]);

  const selectTopicSuggestion = useCallback((suggestion: TopicSuggestion) => {
    setTopicQuery(suggestion.query);
    setSelectedTopicSuggestionId(suggestion.id);
  }, []);

  const loadTopicSuggestionsList = useCallback(async () => {
    setTopicSuggestionsLoading(true);
    try {
      const res = await fetch("/api/generate/topic/suggestions", {
        credentials: "include",
      });
      const data = await readJson<{ suggestions: TopicSuggestion[] }>(res);
      setTopicSuggestions(data.suggestions ?? []);
    } catch {
      setTopicSuggestions([]);
    } finally {
      setTopicSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopicSuggestionsList();
  }, [loadTopicSuggestionsList]);

  useEffect(() => {
    if (!projectId) return;
    const completed = tasks.find(
      (task) =>
        task.kind === "generation" &&
        task.projectId === projectId &&
        task.status === "ready" &&
        task.id !== lastSyncedTaskRef.current,
    );
    if (!completed) return;
    lastSyncedTaskRef.current = completed.id;
    void loadDeckCards(projectId);
    void loadProjectSource(projectId);
    void loadTopicSuggestionsList();
  }, [loadDeckCards, loadProjectSource, loadTopicSuggestionsList, projectId, tasks]);

  function handleGenerateClick() {
    setError(null);
    const prerequisiteError = getGeneratePrerequisitesError();
    if (prerequisiteError) {
      setError(prerequisiteError);
      return;
    }
    if (!projectId) {
      setNameModalUseAuto(true);
      setNameModalCustom("");
      setNameModalOpen(true);
      return;
    }
    void generate();
  }

  function confirmNameAndGenerate() {
    const resolvedName = nameModalUseAuto ? suggestedDeckName : nameModalCustom.trim();
    if (!resolvedName) {
      setError("Enter a deck name or choose auto-name.");
      return;
    }
    setNameModalOpen(false);
    void generate(resolvedName);
  }

  async function generate(resolvedDeckName?: string) {
    setError(null);
    const effectiveDeckName = (resolvedDeckName ?? deckName ?? "").trim();

    try {
      const prerequisiteError = getGeneratePrerequisitesError();
      if (prerequisiteError) {
        throw new Error(prerequisiteError);
      }

      // Editing an existing deck's stored source: generate straight from it
      // (its edited text is already persisted) without re-uploading anything.
      if (showSourceEditor && currentSource && projectId) {
        const taskId = startDeckGeneration({
          projectId,
          deckName: effectiveDeckName || (deckName ?? "").trim(),
          settings,
          existingSourceId: currentSource.id,
          sourceMode: "document",
          file: null,
        });
        setActiveTaskId(taskId);
        return;
      }

      if (!projectId && !effectiveDeckName) {
        throw new Error("Name your deck before generating.");
      }

      const taskId = startDeckGeneration({
        projectId,
        deckName: effectiveDeckName,
        settings,
        chunkIndices: sourceMode === "topic" ? undefined : chunkIndices,
        sourceMode,
        topicQuery: sourceMode === "topic" ? topicQuery.trim() : undefined,
        videoInputMode,
        text,
        youtubeUrl,
        notionPageId: sourceMode === "notion" ? notionPage?.id : undefined,
        notionPageTitle: sourceMode === "notion" ? notionPage?.title : undefined,
        previewRawText,
        file,
        extractImages: sourceMode === "document" ? extractImages : undefined,
        onProjectCreated: (nextProjectId, nextDeckName) => {
          setProjectId(nextProjectId);
          setDeckName(nextDeckName);
          setExistingDecks((prev) => [
            { id: nextProjectId, name: nextDeckName },
            ...prev.filter((deck) => deck.id !== nextProjectId),
          ]);
          router.replace(`/create?deck=${nextProjectId}`);
        },
      });
      if (effectiveDeckName) setDeckName(effectiveDeckName);
      setActiveTaskId(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const handleCardSaved = useCallback((updated: OverlayCard) => {
    // The overlay owns the PUT (auto-save); we just sync the list row in place.
    setCards((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }, []);

  const handleGenerateFromSelection = useCallback(
    (selectedText: string) => {
      if (!currentSource || !projectId) {
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
        existingSourceId: currentSource.id,
        scopeText: trimmed,
        sourceMode: "document",
        file: null,
      });
      setActiveTaskId(taskId);
    },
    [
      currentSource,
      projectId,
      generating,
      textCardTypes.length,
      startDeckGeneration,
      deckName,
      topbarDeckLabel,
      settings,
    ],
  );

  async function deleteCard() {
    if (!focused) return;
    const targetId = focused.id;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${targetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setCards((prev) => prev.filter((c) => c.id !== targetId));
      setTotalCards((prev) => Math.max(0, prev - 1));
      setOverlayOpen(false);
      setFocusedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete card");
    } finally {
      setSaving(false);
    }
  }

  function toggleChunk(index: number) {
    setSelectedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** Ensure a deck exists (creating one if needed) before adding a manual card. */
  const ensureProjectId = useCallback(async (): Promise<string> => {
    if (projectId) return projectId;
    const name = (deckName ?? "").trim() || suggestedDeckName;
    const res = await fetch("/api/projects", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, deck_name: name, settings }),
    });
    const project = await readJson<{ id: string }>(res);
    setProjectId(project.id);
    setDeckName(name);
    setExistingDecks((prev) => [
      { id: project.id, name },
      ...prev.filter((deck) => deck.id !== project.id),
    ]);
    router.replace(`/create?deck=${project.id}`);
    return project.id;
  }, [projectId, deckName, suggestedDeckName, settings, router]);

  const createCardFrom = useCallback(
    async (pid: string, payload: Record<string, unknown>) => {
      const res = await fetch("/api/cards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid, ...payload }),
      });
      const card = await readJson<{ id: string }>(res);
      await loadDeckCards(pid);
      setFocusedId(card.id);
      setOverlayOpen(true);
    },
    [loadDeckCards],
  );

  async function writeManualCard() {
    setError(null);
    try {
      const pid = await ensureProjectId();
      await createCardFrom(pid, { type: "basic", front: "", back: "", tags: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add a card");
    }
  }

  const handleViewSource = useCallback(
    (snippet: string) => {
      const text = (snippet ?? "").trim();
      if (!text) return;
      if (!currentSource || replaceSource) {
        setReplaceSource(false);
      }
      setSourceScrollTarget({ text, nonce: Date.now() });
    },
    [currentSource, replaceSource],
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

  return (
    <div style={s.shell}>
      <PageHeaderSlot menuItems={headerMenuItems} />

      <header style={top.bar} className="create-topbar">
        <DeckSwitcher
          decks={existingDecks}
          currentId={projectId}
          label={topbarDeckLabel}
          sourceType={currentSource?.type ?? null}
          disabled={decksLoading || generating}
          onSelect={(value) => void handleDeckChange(value)}
          onImportApkg={openAnkiImport}
        />
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
                      style={{ ...top.deckItem, ...(selected ? top.deckItemActive : {}) }}
                      onClick={() => {
                        setDetailLevel(option.value);
                        close();
                      }}
                    >
                      <span style={top.menuOptionText}>
                        <span style={top.deckItemLabel}>{option.label}</span>
                        <span style={top.menuOptionDesc}>
                          {DETAIL_PILL_DESCRIPTIONS[option.value]}
                        </span>
                      </span>
                      {selected ? <i className="ri-check-line" style={top.deckItemCheck} /> : null}
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
                  const optionDisabled = Boolean(option.requiresDocument) && !occlusionAvailable;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={selected}
                      disabled={optionDisabled}
                      title={
                        optionDisabled
                          ? "Upload a PDF, Word, or PowerPoint file to enable."
                          : undefined
                      }
                      style={{
                        ...top.deckItem,
                        ...(optionDisabled ? top.menuItemDisabled : {}),
                      }}
                      onClick={() => toggleCardType(option.value)}
                    >
                      <i className={option.icon} style={top.deckItemIcon} />
                      <span style={top.deckItemLabel}>{option.label}</span>
                      <span
                        style={{ ...top.menuCheckbox, ...(selected ? top.menuCheckboxOn : {}) }}
                        aria-hidden
                      >
                        {selected ? <i className="ri-check-line" /> : null}
                      </span>
                    </button>
                  );
                })}
                <div style={top.deckDivider} />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={clozeSelected && clozeHints}
                  disabled={!clozeSelected}
                  title={
                    clozeSelected ? undefined : "Enable Fill-in-the-Blank cards first."
                  }
                  style={{ ...top.deckItem, ...(!clozeSelected ? top.menuItemDisabled : {}) }}
                  onClick={() => setClozeHints((prev) => !prev)}
                >
                  <i className="ri-lightbulb-line" style={top.deckItemIcon} />
                  <span style={top.deckItemLabel}>Hints on blanks</span>
                  <span
                    style={{
                      ...top.menuCheckbox,
                      ...(clozeSelected && clozeHints ? top.menuCheckboxOn : {}),
                    }}
                    aria-hidden
                  >
                    {clozeSelected && clozeHints ? <i className="ri-check-line" /> : null}
                  </span>
                </button>
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
                      style={{ ...top.deckItem, ...(selected ? top.deckItemActive : {}) }}
                      onClick={() => {
                        setFocusPreset(option.value);
                        close();
                      }}
                    >
                      <span style={top.menuOptionText}>
                        <span style={top.deckItemLabel}>{option.label}</span>
                        <span style={top.menuOptionDesc}>{option.description}</span>
                      </span>
                      {selected ? <i className="ri-check-line" style={top.deckItemCheck} /> : null}
                    </button>
                  );
                })}
              </>
            )}
          </TopbarPopover>
          <TopbarPopover
            icon="ri-price-tag-3-line"
            label="Tags"
            value={autoTags ? "Auto" : "Off"}
            disabled={generating}
            width={260}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={autoTags}
                  style={{ ...top.deckItem, ...(autoTags ? top.deckItemActive : {}) }}
                  onClick={() => {
                    setAutoTags(true);
                    close();
                  }}
                >
                  <span style={top.menuOptionText}>
                    <span style={top.deckItemLabel}>Auto</span>
                    <span style={top.menuOptionDesc}>Tag new cards by topic and source.</span>
                  </span>
                  {autoTags ? <i className="ri-check-line" style={top.deckItemCheck} /> : null}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!autoTags}
                  style={{ ...top.deckItem, ...(!autoTags ? top.deckItemActive : {}) }}
                  onClick={() => {
                    setAutoTags(false);
                    close();
                  }}
                >
                  <span style={top.menuOptionText}>
                    <span style={top.deckItemLabel}>Off</span>
                    <span style={top.menuOptionDesc}>Generate new cards without tags.</span>
                  </span>
                  {!autoTags ? <i className="ri-check-line" style={top.deckItemCheck} /> : null}
                </button>
              </>
            )}
          </TopbarPopover>
          <button
            type="button"
            className="create-topbar-control create-topbar-control--primary"
            onClick={handleGenerateClick}
            disabled={generating || previewBusy}
          >
            <i
              className={`create-topbar-control__icon ${generating ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-line"}`}
              aria-hidden
            />
            {generating ? "Generating…" : "Generate"}
          </button>
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
              <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
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
          {showSourceEditor && currentSource ? (
            <SourceDocumentEditor
              sourceId={currentSource.id}
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
            />
          ) : (
            <div style={s.sourceScroll}>
              {currentSource && replaceSource ? (
                <div style={s.replaceBanner}>
                  <span style={s.hint}>Replacing the source for this deck.</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReplaceSource(false)}
                  >
                    <i className="ri-arrow-go-back-line" />
                    Back to document
                  </button>
                </div>
              ) : null}
              <div style={s.section}>
                <h2 style={s.sectionTitle}>Source</h2>
            <div style={tab.wrap}>
              <button
                type="button"
                onClick={() => {
                  setSourceMode("text");
                  setFile(null);
                  setPreviewRawText(null);
                }}
                style={{ ...tab.btn, ...(sourceMode === "text" ? tab.btnActive : {}) }}
              >
                <i className="ri-file-text-line" />
                Free text
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceMode("document");
                  setFile(null);
                  setPreviewRawText(null);
                }}
                style={{ ...tab.btn, ...(sourceMode === "document" ? tab.btnActive : {}) }}
              >
                <i className="ri-file-upload-line" />
                Document
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceMode("video");
                  setFile(null);
                  setYoutubeUrl("");
                  setDebouncedYoutubeUrl("");
                  setVideoInputMode("upload");
                  setPreviewRawText(null);
                }}
                style={{ ...tab.btn, ...(sourceMode === "video" ? tab.btnActive : {}) }}
              >
                <i className="ri-video-line" />
                Video
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceMode("notion");
                  setFile(null);
                  setPreviewRawText(null);
                  setChunks([]);
                  setSelectedChunks(new Set());
                }}
                style={{ ...tab.btn, ...(sourceMode === "notion" ? tab.btnActive : {}) }}
              >
                <i className="ri-notion-line" />
                Notion
              </button>
              <button
                type="button"
                onClick={() => {
                  setSourceMode("topic");
                  setFile(null);
                  setText("");
                  setYoutubeUrl("");
                  setDebouncedYoutubeUrl("");
                  setPreviewRawText(null);
                  setChunks([]);
                  setSelectedChunks(new Set());
                }}
                style={{ ...tab.btn, ...(sourceMode === "topic" ? tab.btnActive : {}) }}
              >
                <i className="ri-lightbulb-line" />
                Topic
              </button>
            </div>

            <div
              className="field"
              style={{ marginTop: 16, display: sourceMode === "text" ? undefined : "none" }}
            >
              <label className="field-label" htmlFor="source-text">
                Paste notes, transcripts, or any text
              </label>
              <textarea
                id="source-text"
                className="textarea"
                value={text ?? ""}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your source material here…"
                style={{ minHeight: 200 }}
                aria-hidden={sourceMode !== "text"}
                tabIndex={sourceMode === "text" ? undefined : -1}
              />
              <span style={s.hint}>{(text ?? "").length.toLocaleString()} characters</span>
            </div>

            <div
              className="field"
              style={{ marginTop: 16, display: sourceMode === "document" ? undefined : "none" }}
              aria-hidden={sourceMode !== "document"}
            >
              <span className="field-label">PDF, Word, or PowerPoint</span>
              <input
                ref={documentInputRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
                tabIndex={-1}
              />
              <button
                type="button"
                style={s.dropzoneBtn}
                onClick={() => documentInputRef.current?.click()}
                tabIndex={sourceMode === "document" ? undefined : -1}
              >
                <i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: "var(--ink-400)" }} />
                <span style={s.dropzoneTitle}>
                  {file ? file.name : "Click to choose a file"}
                </span>
                <span style={s.hint}>PDF, .docx, .pptx · up to {MAX_FILE_MB} MB</span>
              </button>
              <label style={s.extractImagesRow}>
                <input
                  type="checkbox"
                  checked={extractImages}
                  onChange={(e) => setExtractImages(e.target.checked)}
                  style={{ flexShrink: 0 }}
                />
                <span>
                  Extract images into notes
                  <span style={{ ...s.hint, display: "block" }}>
                    Figures and diagrams appear alongside the text, in place.
                  </span>
                </span>
              </label>
              {previewBusy && sourceMode === "document" && (
                <span style={s.hint}>
                  <i className="ri-loader-4-line icon-spin" /> Extracting text…
                </span>
              )}
            </div>

            <div
              className="field"
              style={{ marginTop: 16, display: sourceMode === "video" ? undefined : "none" }}
              aria-hidden={sourceMode !== "video"}
            >
              <div style={{ ...tab.wrap, marginBottom: 12, alignSelf: "flex-start" }}>
                <button
                  type="button"
                  onClick={() => {
                    setVideoInputMode("upload");
                    setYoutubeUrl("");
                    setDebouncedYoutubeUrl("");
                    setPreviewRawText(null);
                    setChunks([]);
                    setSelectedChunks(new Set());
                  }}
                  style={{ ...tab.btn, ...(videoInputMode === "upload" ? tab.btnActive : {}) }}
                  tabIndex={sourceMode === "video" ? undefined : -1}
                >
                  <i className="ri-upload-2-line" />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVideoInputMode("youtube");
                    setFile(null);
                    setPreviewRawText(null);
                    setChunks([]);
                    setSelectedChunks(new Set());
                  }}
                  style={{ ...tab.btn, ...(videoInputMode === "youtube" ? tab.btnActive : {}) }}
                  tabIndex={sourceMode === "video" ? undefined : -1}
                >
                  <i className="ri-youtube-line" />
                  YouTube link
                </button>
              </div>

              <div style={{ display: videoInputMode === "upload" ? undefined : "none" }}>
                <span className="field-label">Video file</span>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept={VIDEO_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                  tabIndex={-1}
                />
                <button
                  type="button"
                  style={s.dropzoneBtn}
                  onClick={() => videoInputRef.current?.click()}
                  tabIndex={sourceMode === "video" && videoInputMode === "upload" ? undefined : -1}
                >
                  <i className="ri-film-line" style={{ fontSize: 28, color: "var(--ink-400)" }} />
                  <span style={s.dropzoneTitle}>
                    {file ? file.name : "Click to choose a video"}
                  </span>
                  <span style={s.hint}>MP4, WebM, MOV · up to {MAX_VIDEO_MB} MB</span>
                </button>
                {previewBusy && sourceMode === "video" && videoInputMode === "upload" && (
                  <span style={s.hint}>
                    <i className="ri-loader-4-line icon-spin" /> Transcribing video…
                  </span>
                )}
                <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                  Speech is transcribed with Whisper, then turned into flashcards.
                </span>
              </div>

              <div style={{ display: videoInputMode === "youtube" ? undefined : "none" }}>
                <label className="field-label" htmlFor="youtube-url">
                  YouTube URL
                </label>
                <input
                  id="youtube-url"
                  className="input"
                  value={youtubeUrl ?? ""}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  aria-hidden={sourceMode !== "video" || videoInputMode !== "youtube"}
                  tabIndex={
                    sourceMode === "video" && videoInputMode === "youtube" ? undefined : -1
                  }
                />
                {previewBusy && sourceMode === "video" && videoInputMode === "youtube" && (
                  <span style={s.hint}>
                    <i className="ri-loader-4-line icon-spin" /> Fetching captions…
                  </span>
                )}
                {!previewBusy &&
                sourceMode === "video" &&
                videoInputMode === "youtube" &&
                parseYouTubeVideoId(youtubeUrl) &&
                chunks.length > 0 ? (
                  <span style={s.hint}>Captions loaded · {chunks.length} segments</span>
                ) : null}
                <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                  Uses the video&apos;s captions (manual or auto-generated). Videos without subtitles cannot be used.
                </span>
              </div>
            </div>

            {sourceMode === "notion" ? (
              <div className="field" style={{ marginTop: 16 }}>
                <span className="field-label">Notion page</span>
                <NotionPagePicker
                  returnTo={projectId ? `/create?deck=${projectId}` : "/create"}
                  selectedPageId={notionPage?.id ?? null}
                  onSelect={(page) => setNotionPage(page)}
                  disabled={generating}
                />
                {previewBusy ? (
                  <span style={s.hint}>
                    <i className="ri-loader-4-line icon-spin" /> Reading page…
                  </span>
                ) : notionPage && chunks.length > 0 ? (
                  <span style={s.hint}>
                    “{truncate(notionPage.title, 48)}” loaded · {chunks.length} section
                    {chunks.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div
              className="field"
              style={{ marginTop: 16, display: sourceMode === "topic" ? undefined : "none" }}
              aria-hidden={sourceMode !== "topic"}
            >
              <label className="field-label" htmlFor="topic-query">
                What should the cards cover?
              </label>
              <span style={s.hint}>
                Type a topic or pick a suggestion from your decks and past topic
                generations.
              </span>
              <input
                id="topic-query"
                className="input"
                value={topicQuery ?? ""}
                onChange={(e) => {
                  setTopicQuery(e.target.value);
                  setSelectedTopicSuggestionId(null);
                }}
                placeholder="e.g. heart failure guidelines, flags of the world"
                aria-hidden={sourceMode !== "topic"}
                tabIndex={sourceMode === "topic" ? undefined : -1}
              />
              {topicSuggestionsLoading ? (
                <span style={s.hint}>Loading suggestions…</span>
              ) : topicSuggestions.length > 0 ? (
                <div style={{ ...s.topicChipRow, marginTop: 4 }}>
                  {topicSuggestions.map((suggestion) => {
                    const active = selectedTopicSuggestionId === suggestion.id;
                    return (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => selectTopicSuggestion(suggestion)}
                        style={{
                          ...s.topicChip,
                          ...(active ? s.topicChipActive : {}),
                        }}
                        aria-pressed={active}
                        tabIndex={sourceMode === "topic" ? undefined : -1}
                      >
                        {suggestion.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span style={s.hint}>
                  Suggestions appear after you generate, import, or add community decks.
                </span>
              )}
            </div>
          </div>

          {chunks.length > 0 && sourceMode !== "topic" && (
            <div style={s.section}>
              <h2 style={s.sectionTitle}>Generate from</h2>
              <div style={tab.wrap}>
                <button
                  type="button"
                  onClick={() => setScopeMode("all")}
                  style={{ ...tab.btn, ...(scopeMode === "all" ? tab.btnActive : {}) }}
                >
                  Entire source
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("segments")}
                  style={{ ...tab.btn, ...(scopeMode === "segments" ? tab.btnActive : {}) }}
                >
                  Specific segments
                </button>
              </div>

              {scopeMode === "segments" && (
                <div style={s.segmentBox}>
                  <div style={s.segmentToolbar}>
                    <span style={s.hint}>
                      {selectedChunks.size} of {chunks.length} selected
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedChunks(new Set(chunks.map((c) => c.index)))}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedChunks(new Set())}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div style={s.segmentList}>
                    {chunks.map((chunk) => {
                      const checked = selectedChunks.has(chunk.index);
                      return (
                        <label
                          key={chunk.index}
                          style={{
                            ...s.segmentRow,
                            ...(checked ? s.segmentRowActive : {}),
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleChunk(chunk.index)}
                            style={s.segmentCheckbox}
                          />
                          {chunk.thumbnailUrl ? (
                            <img
                              src={chunk.thumbnailUrl}
                              alt=""
                              style={s.segmentThumb}
                            />
                          ) : (
                            <div style={s.segmentThumbPlaceholder} aria-hidden>
                              <i className="ri-file-text-line" />
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={s.segmentRef}>
                              {chunk.label ?? chunk.sourceRef}
                            </div>
                            <div style={s.segmentPreview}>{chunk.preview}</div>
                            <div style={s.segmentMeta}>
                              {chunk.charCount.toLocaleString()} chars
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {scopeMode === "all" && (
                <p style={{ ...s.hint, marginTop: 12 }}>
                  {chunks.length} segment{chunks.length === 1 ? "" : "s"} · entire source will be used
                </p>
              )}
            </div>
          )}
            </div>
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
        <div style={s.listPane}>
          {cardsLoading ? (
            <CardListSkeleton rows={8} />
          ) : cards.length === 0 ? (
            <div style={s.listEmpty}>
              <i className="ri-sparkling-2-line" style={{ fontSize: 36, color: "var(--ink-300)" }} />
              <p style={s.emptyText}>
                {projectId
                  ? "This deck has no cards yet. Generate from the source panel to add some."
                  : "Your deck preview will show up here after generation."}
              </p>
            </div>
          ) : (
            <div style={s.listScroll} ref={listScrollRef}>
              {cards.map((card, index) => {
                const active = card.id === focusedId && overlayOpen;
                const sourceLabel = card.source_ref
                  ? formatSegmentLabel(card.source_ref)
                  : null;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      setFocusedId(card.id);
                      setOverlayOpen(true);
                    }}
                    style={{
                      ...s.cardRow,
                      ...(active ? s.cardRowActive : {}),
                    }}
                  >
                    <div style={s.cardRowTop}>
                      <span style={s.cardIndex}>#{index + 1}</span>
                      <div style={s.cardRowBadges}>
                        {sourceLabel ? (
                          <span style={s.sourceChip} title={card.source_ref ?? undefined}>
                            <i className="ri-file-search-line" />
                            {sourceLabel}
                          </span>
                        ) : null}
                        <span className={cardTypeChipClass(card.type)}>
                          {cardTypeLabel(card.type, "short")}
                        </span>
                      </div>
                    </div>
                    {card.type === "cloze" && card.cloze_text ? (
                      <div style={{ ...s.cardPreview, ...s.cardPreviewClamp }}>
                        <CardContentRenderer
                          content={card.cloze_text}
                          clozeMode="revealed"
                          className="dh-card-content-renderer--compact"
                        />
                      </div>
                    ) : (
                      <div style={s.cardPreview}>
                        <CardContentRenderer
                          content={cardPreviewText(card)}
                          className="dh-card-content-renderer--compact"
                        />
                      </div>
                    )}
                    {cardAnswerText(card) ? (
                      <div style={s.cardAnswer}>
                        <CardContentRenderer
                          content={cardAnswerText(card)}
                          className="dh-card-content-renderer--compact"
                        />
                      </div>
                    ) : null}
                    {card.tags.length > 0 ? (
                      <StudyCardTags tags={card.tags} align="start" />
                    ) : null}
                  </button>
                );
              })}
              {hasMoreCards ? (
                <div ref={loadMoreRef} style={s.loadMoreRow} aria-hidden>
                  {loadingMoreCards ? (
                    <span style={s.loadMoreLabel}>
                      <i className="ri-loader-4-line icon-spin" /> Loading more…
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          <div style={top.listFooter}>
            <button
              type="button"
              style={top.writeManualBtn}
              onClick={() => void writeManualCard()}
              disabled={generating}
            >
              <i className="ri-add-line" /> Write a card manually
            </button>
          </div>
        </div>
      </section>
      </div>

      {nameModalOpen ? (
        <AnimatedModal
          title="Name your deck"
          onClose={() => {
            if (!generating) setNameModalOpen(false);
          }}
          maxWidth={440}
        >
          <div style={s.nameModalBody}>
            <p style={s.nameModalLead}>
              Choose a name now, or let DeepHaus name the deck from your source.
            </p>
            <label style={s.nameModalOption}>
              <input
                type="radio"
                name="deck-name-mode"
                checked={nameModalUseAuto}
                onChange={() => setNameModalUseAuto(true)}
              />
              <span style={s.nameModalOptionText}>
                <span style={s.nameModalOptionLabel}>Auto-name</span>
                <span style={s.nameModalOptionDesc}>{suggestedDeckName}</span>
              </span>
            </label>
            <label style={s.nameModalOption}>
              <input
                type="radio"
                name="deck-name-mode"
                checked={!nameModalUseAuto}
                onChange={() => setNameModalUseAuto(false)}
              />
              <span style={s.nameModalOptionText}>
                <span style={s.nameModalOptionLabel}>Custom name</span>
              </span>
            </label>
            {!nameModalUseAuto ? (
              <input
                className="input"
                value={nameModalCustom}
                onChange={(e) => setNameModalCustom(e.target.value)}
                placeholder="e.g. Biology midterm"
                autoFocus
                aria-label="Custom deck name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmNameAndGenerate();
                }}
              />
            ) : null}
            <div style={s.nameModalActions}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setNameModalOpen(false)}
                disabled={generating}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmNameAndGenerate}
                disabled={generating || (!nameModalUseAuto && !nameModalCustom.trim())}
              >
                {generating ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </AnimatedModal>
      ) : null}

      <CardEditOverlay
        open={overlayOpen && Boolean(focused)}
        card={focused ? draftToOverlayCard(focused) : null}
        deckName={(deckName ?? "").trim() || "New deck"}
        cardIndex={focused ? cards.findIndex((c) => c.id === focused.id) : -1}
        busy={generating || cardsLoading || saving}
        onClose={() => setOverlayOpen(false)}
        onSaved={handleCardSaved}
        onDelete={cards.length > 0 ? deleteCard : undefined}
        onViewSource={showSourceEditor ? handleViewSource : undefined}
        allowUnlinkSource
      />

      <AnkiImportOverlay
        open={ankiImportOpen}
        onClose={() => setAnkiImportOpen(false)}
      />

    </div>
  );
}

const tab = {
  wrap: {
    display: "inline-flex",
    padding: 3,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    gap: 3,
    flexWrap: "wrap" as const,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 13px",
    background: "transparent",
    color: "var(--ink-500)",
    border: "1px solid transparent",
    borderRadius: 6,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
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
    height: "100vh",
    padding: "14px 20px 18px",
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
  sourceScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  editorPaneBody: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  editorHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-1)",
  },
  editorDeckSelect: {
    flex: 1,
    minWidth: 0,
    font: "500 13px/18px var(--font-sans)",
  },
  editorHeaderActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    padding: 0,
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 8,
    color: "var(--ink-500)",
    cursor: "pointer",
  },
  editorWrap: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  replaceBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 10px",
    background: "var(--brand-25)",
    border: "1px solid var(--brand-100)",
    borderRadius: 8,
  },
  sourceFooter: {
    borderTop: "1px solid var(--border-1)",
    padding: "14px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  collapseBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    padding: 0,
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    color: "var(--ink-400)",
    cursor: "pointer",
  },
  expandRail: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "14px 0",
    background: "transparent",
    border: "none",
    color: "var(--ink-500)",
    cursor: "pointer",
  },
  expandRailLabel: {
    font: "500 12px/16px var(--font-sans)",
    color: "var(--ink-500)",
    writingMode: "vertical-rl",
    letterSpacing: "0.04em",
  },
  expandRailSpinner: {
    width: 18,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sourceActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  section: {},
  deckSection: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 4,
    borderBottom: "1px solid var(--border-1)",
  },
  deckSelectFull: {
    width: "100%",
    font: "500 14px/20px var(--font-sans)",
  },
  deckLinks: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: -4,
  },
  topicPresets: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    marginTop: 4,
  },
  topicCategory: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  topicCategoryLabel: {
    font: "600 11px/14px var(--font-sans)",
    color: "var(--fg-4)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  topicChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  topicChip: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--border-2)",
    background: "var(--white)",
    color: "var(--ink-800)",
    font: "500 12px/16px var(--font-sans)",
    cursor: "pointer",
    transition: "border-color 120ms ease, background 120ms ease",
  },
  topicChipActive: {
    border: "1px solid var(--teal-500)",
    background: "var(--brand-25)",
    color: "var(--ink-900)",
  },
  sectionTitle: {
    margin: "0 0 12px",
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  nameModalBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 4,
  },
  nameModalLead: {
    margin: 0,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  nameModalOption: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border-2)",
    background: "var(--paper-soft)",
    cursor: "pointer",
  },
  nameModalOptionText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  nameModalOptionLabel: {
    font: "600 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  nameModalOptionDesc: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
    wordBreak: "break-word",
  },
  nameModalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  status: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-3)",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 20,
  },
  statusIcon: {
    width: 18,
    height: 18,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  statusHint: {
    font: "400 12px/17px var(--font-sans)",
    color: "var(--fg-4)",
  },
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "28px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 8,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
  },
  dropzoneBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "28px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 8,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
  },
  dropzoneTitle: {
    color: "var(--ink-700)",
    font: "500 14px/20px var(--font-sans)",
  },
  extractImagesRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 10,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-2)",
    cursor: "pointer",
  },
  segmentBox: {
    marginTop: 12,
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  segmentToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  segmentList: {
    maxHeight: 420,
    overflow: "auto",
  },
  segmentRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-1)",
    cursor: "pointer",
    background: "var(--white)",
  },
  segmentCheckbox: {
    marginTop: 24,
    flexShrink: 0,
  },
  segmentThumb: {
    width: 88,
    height: 64,
    objectFit: "cover" as const,
    borderRadius: 6,
    border: "1px solid var(--border-2)",
    flexShrink: 0,
    background: "var(--paper-soft)",
  },
  segmentThumbPlaceholder: {
    width: 88,
    height: 64,
    borderRadius: 6,
    border: "1px dashed var(--border-2)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--paper-soft)",
    color: "var(--ink-400)",
    fontSize: 22,
  },
  segmentRowActive: {
    background: "var(--bg-surface-2)",
  },
  segmentRef: {
    font: "600 12px/16px var(--font-sans)",
    color: "var(--ink-900)",
  },
  segmentPreview: {
    marginTop: 4,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--ink-700)",
  },
  segmentMeta: {
    marginTop: 4,
    font: "400 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  cardsPane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: 12,
  },
  cardsTopBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  cardsTitle: {
    margin: 0,
    font: "600 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
  },
  cardsSplit: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 380px",
    gridTemplateRows: "minmax(0, 1fr)",
    gap: 16,
    flex: 1,
    minHeight: 0,
    alignItems: "stretch",
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
  },
  listScroll: {
    flex: 1,
    overflow: "auto",
  },
  loadMoreRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    borderBottom: "1px solid var(--border-1)",
  },
  loadMoreLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  listEmpty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 40,
    textAlign: "center",
  },
  emptyText: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
    maxWidth: 280,
  },
  cardRow: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    border: 0,
    borderBottom: "1px solid var(--border-1)",
    background: "var(--white)",
    cursor: "pointer",
  },
  cardRowActive: {
    background: "var(--brand-25)",
    boxShadow: "inset 2px 0 0 var(--teal-500)",
  },
  cardRowTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  cardRowBadges: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  sourceChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    background: "var(--brand-25)",
    color: "var(--teal-700)",
    font: "600 11px/16px var(--font-sans)",
    maxWidth: 140,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardIndex: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  cardPreview: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  cardPreviewClamp: {
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
    lineHeight: "20px",
  },
  cardAnswer: {
    marginTop: 4,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
};

// --- Redesigned top bar + deck switcher ------------------------------------

const sourceTypeIcon = sourceTypeIconClass;

const DETAIL_PILL_DESCRIPTIONS: Record<DetailLevel, string> = {
  low: "Fewer cards, only the highest-yield facts.",
  medium: "Balanced coverage of the material.",
  high: "Comprehensive — cover nearly everything.",
};

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
        <span className="create-topbar-control__label">{label}</span>
        <span className="create-toolbar-pill-hover-label" aria-hidden>
          {value}
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
  sourceType,
  disabled,
  onSelect,
  onImportApkg,
}: {
  decks: DeckOption[];
  currentId: string | null;
  label: string;
  sourceType: SourceType | null;
  disabled?: boolean;
  onSelect: (value: string) => void;
  onImportApkg?: () => void;
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
          className={`${sourceTypeIcon(sourceType)} create-topbar-control__icon create-topbar-control__icon--accent`}
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
            style={top.deckItem}
            onClick={() => {
              setOpen(false);
              onSelect(NEW_DECK_VALUE);
            }}
          >
            <i className="ri-add-line" style={top.deckItemIcon} />
            <span style={top.deckItemLabel}>Create new deck…</span>
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
                    style={{
                      ...top.deckItem,
                      ...(deck.id === currentId ? top.deckItemActive : {}),
                    }}
                    onClick={() => {
                      setOpen(false);
                      onSelect(deck.id);
                    }}
                  >
                    <i className="ri-stack-line" style={top.deckItemIcon} />
                    <span style={top.deckItemLabel}>{deck.name}</span>
                    {deck.id === currentId ? (
                      <i className="ri-check-line" style={top.deckItemCheck} />
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div style={top.deckDivider} />
          <button
            type="button"
            role="menuitem"
            style={top.deckItem}
            onClick={() => {
              setOpen(false);
              onImportApkg?.();
            }}
          >
            <i className="ri-folder-download-line" style={top.deckItemIcon} />
            <span style={top.deckItemLabel}>Import .apkg</span>
          </button>
          {currentId ? (
            <Link
              href={`/decks/${currentId}`}
              role="menuitem"
              style={top.deckItem}
              onClick={() => setOpen(false)}
            >
              <i className="ri-external-link-line" style={top.deckItemIcon} />
              <span style={top.deckItemLabel}>Open deck</span>
            </Link>
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
  listFooter: {
    flexShrink: 0,
    padding: "10px 12px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--white)",
  },
  writeManualBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    padding: "9px 12px",
    background: "transparent",
    border: "1px dashed var(--border-2)",
    borderRadius: 8,
    color: "var(--fg-secondary)",
    font: "500 13px/18px var(--font-sans)",
    cursor: "pointer",
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
    minWidth: 280,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
  },
  deckScroll: {
    maxHeight: 300,
    overflow: "auto",
  },
  deckItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    background: "transparent",
    border: "none",
    color: "var(--fg-primary)",
    font: "500 13px/18px var(--font-sans)",
    textAlign: "left",
    textDecoration: "none",
    cursor: "pointer",
  },
  deckItemActive: {
    background: "var(--brand-25)",
  },
  deckItemIcon: {
    width: 18,
    fontSize: 15,
    color: "var(--fg-4)",
    flexShrink: 0,
  },
  deckItemLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deckItemCheck: {
    color: "var(--teal-600)",
    flexShrink: 0,
  },
  deckDivider: {
    height: 1,
    background: "var(--border-1)",
    margin: "4px 0",
  },
};
