"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { fitDeckName } from "@/lib/projects/deck-name";
import { consumeAutoSend } from "@/lib/create/auto-send";
import {
  choiceFromSettings,
  choiceSettingsPatch,
  DEFAULT_GENERATION_CHOICE,
  readNewDeckChoice,
  writeNewDeckChoice,
  type GenerationChoice,
} from "@/lib/create/generation-choice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseGenerationSettings,
  DEFAULT_FOCUS_PRESET,
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  type FocusPreset,
  type DetailLevel,
  type QualityLevel,
  type DraftCard,
  type ImageOcclusionData,
  type GenerationCardType,
  type GenerationSettings,
  GENERATION_CARD_TYPE_OPTIONS,
  type CardType,
} from "@deephaus/shared";
import { AnkiImportOverlay } from "@/components/anki-import-overlay";
import type { DeckImportMode } from "@/components/deck-import-view";
import { BrandMark } from "@/components/brand-mark";
import { CreateStartSkeleton } from "@/components/create/create-start-skeleton";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { CardEditOverlay, type OverlayCard } from "@/components/card-edit-overlay";
import type { CreateComposerParams } from "@/lib/decks/create-link";
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
  CreateComposer,
  type ComposerIntent,
  type CreateComposerHandle,
  type GenerationControls,
} from "@/components/create/create-composer";
import { CreateThread, WorkingBars, type ThreadMessage } from "@/components/create/create-thread";
import { DeckMenu } from "@/components/create/deck-menu";
import { GenerateSourcesButton } from "@/components/create/generate-sources-button";
import { restoreConversation, serializeConversation } from "@/components/create/thread-storage";
import {
  attachmentIcon,
  attachmentTitle,
  newAttachmentId,
  suggestDeckName,
  type ComposerAttachment,
} from "@/components/create/composer-sources";
import { ASSISTANT_EDIT_SUGGESTIONS } from "@/lib/cards/assistant-edit";
import { assistantEditCardsApi } from "@/lib/cards/assistant-edit-client";
import { generateCardMnemonicApi, regenerateCardApi } from "@/lib/cards/card-ai-actions-client";
import { updateCardApi } from "@/lib/cards/update";
import { deleteSourceApi } from "@/lib/sources/delete-source-client";
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
import { useBackgroundTasks, type BackgroundTask } from "@/lib/background-tasks/context";
import {
  AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE,
  isAiCreditsExhaustedMessage,
} from "@/lib/credits/exhausted-message";
import { useSettings } from "@/components/settings/settings-context";
import { prefetchSourceDocument } from "@/lib/sources/source-document-cache";
import { apiFetch } from "@/lib/api/fetch";
import { isAuthNetworkError } from "@/lib/auth-errors";
import "@/components/rich-text/rich-text.css";
import "@/components/create/create-chat.css";

type DeckOption = { id: string; name: string };
type SourceViewTab = "notes" | "original";

const NEW_DECK_VALUE = "__new__";
const CARD_PAGE_SIZE = 50;

/** Chat/panel split: percentage width of the conversation column, persisted locally. */
const SPLIT_STORAGE_KEY = "dh-create-chat-pct";
const SPLIT_MIN_PCT = 26;
const SPLIT_MAX_PCT = 60;
const SPLIT_DEFAULT_PCT = 37.7;
/** How long a deletion can be undone before it's final. */
const UNDO_WINDOW_MS = 8000;
/** Most cards the batch delete endpoint takes at once. */
const DELETE_BATCH_SIZE = 500;
/** Settle time before a conversation change is saved. */
const CONVERSATION_SAVE_DELAY_MS = 800;
/** Generation control changes settle before they're saved to the deck. */
const CHOICE_SAVE_DELAY_MS = 500;
/** What a new deck starts with before any choice has been remembered. */
const DEFAULT_CHOICE = DEFAULT_GENERATION_CHOICE;
/** Arrow-key step when resizing from the keyboard. */
const SPLIT_KEY_STEP_PCT = 2;
/** Whether linked-card highlights are shown in the Create source document. */
const HIGHLIGHTS_STORAGE_KEY = "dh-create-show-card-highlights";
/** Suggested edits offered above the composer once a deck has cards. */
const EDIT_SUGGESTION_COUNT = 3;
/** Wording that asks for new cards rather than changes to existing ones. */
const GENERATE_INTENT_PATTERN =
  /^(?:please\s+)?(?:add|make|generate|create|write|give me)\b[^.?!]*\b(?:cards?|flashcards?|questions?)\b|\bmore (?:cards|flashcards)\b/i;

type PanelTab = "cards" | "sources";

/** Sources sent together that wait to finish processing before one generation run. */
type PendingGeneration = {
  messageId: string;
  projectId: string;
  deckName: string;
  settings: Partial<GenerationSettings>;
  sourceTaskIds: string[];
};

function messageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

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
  /** Text to start the composer with, from `/create?prompt=`. */
  initialPrompt?: string | null;
  /** Composer choices made on the deck page, from `/create?detail=&focus=&intent=`. */
  initialComposer?: CreateComposerParams;
  /** First name for the start-screen greeting. */
  greetingName?: string | null;
  /** From Explain's "Show in source": focus this card and scroll to its quote. */
  initialCardId?: string | null;
};

export function CreateDeckView({
  initialDeckId = null,
  initialSourceId = null,
  initialCardId = null,
  initialImportMode = null,
  initialPrompt = null,
  initialComposer,
  greetingName = null,
}: Props) {
  const router = useRouter();
  const {
    tasks,
    dismissTask,
    getTaskForProject,
    setInlineProjectId,
    startDeckGeneration,
    startMultiSourceGeneration,
    stopGeneration,
  } = useBackgroundTasks();
  const { openSettings } = useSettings();
  const [deckName, setDeckName] = useState("");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(initialComposer?.detail ?? "medium");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("medium");
  const [selectedTypes, setSelectedTypes] = useState<Set<GenerationCardType>>(
    () => new Set<GenerationCardType>(["basic"]),
  );
  const [focusPreset, setFocusPreset] = useState<FocusPreset>(
    initialComposer?.focus ?? DEFAULT_FOCUS_PRESET,
  );
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
  // --- Conversation (composer + thread) ------------------------------------
  const composerRef = useRef<CreateComposerHandle>(null);
  const linkedComposerRef = useRef(initialComposer);
  const [draftText, setDraftText] = useState(initialPrompt ?? "");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  /** Last seen state of every task the thread reports on (outlives toast dismissal). */
  const [threadTasks, setThreadTasks] = useState<Map<string, BackgroundTask>>(() => new Map());
  /** Edit-vs-generate choice made by hand; null follows the message's wording. */
  const [intentOverride, setIntentOverride] = useState<ComposerIntent | null>(
    initialComposer?.intent ?? null,
  );
  const pendingGenerationsRef = useRef<PendingGeneration[]>([]);
  /** Right-hand panel: the deck's cards or its sources. */
  const [panelTab, setPanelTab] = useState<PanelTab>("cards");
  /** Pane shown on narrow screens, where chat and panel can't sit side by side. */
  const [narrowPane, setNarrowPane] = useState<"chat" | "panel">("chat");
  /** When set, the next message is scoped to this single card (per-card sparkle). */
  const [assistantCardId, setAssistantCardId] = useState<string | null>(null);
  const [editRunning, setEditRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** Message for the undo toast; the action it controls is in `undoActionRef`. */
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const undoActionRef = useRef<{ undo: () => void; commit: () => void; timer: number } | null>(null);
  /** Cards removed from view but not yet deleted, so a refresh can't bring them back. */
  const hiddenCardIdsRef = useRef<Set<string>>(new Set());
  /** Deck whose conversation is loaded here and may be saved. */
  const conversationDeckRef = useRef<string | null>(null);
  const conversationSaveRef = useRef<{ timer: number; save: () => void } | null>(null);
  const lastSavedConversationRef = useRef<string | null>(null);
  const [assistantUndoing, setAssistantUndoing] = useState(false);
  /** Mirrors projectId synchronously so a deck reload can tell "same deck" from "switched". */
  const projectIdRef = useRef<string | null>(null);
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
  const [chatPanePct, setChatPanePct] = useState(SPLIT_DEFAULT_PCT);
  const [splitDragging, setSplitDragging] = useState(false);
  /** Show/hide card-linked passage highlights in the source document. */
  const [showCardHighlights, setShowCardHighlights] = useState(true);
  const splitBodyRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [deckImportOpen, setDeckImportOpen] = useState(Boolean(initialImportMode));
  const [deckImportMode, setDeckImportMode] = useState<DeckImportMode>(
    initialImportMode ?? "anki",
  );

  // Arriving from another page mounts fresh; this covers `?prompt=` changing in place.
  useEffect(() => {
    if (initialPrompt) setDraftText(initialPrompt);
  }, [initialPrompt]);

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

  /** Tasks the conversation has reported on, and the live task list, for cleanup. */
  const shownTaskIdsRef = useRef<Set<string>>(new Set());
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  /** Outcomes already shown in the conversation shouldn't replay in the global toast. */
  const dismissShownTasks = useCallback(() => {
    for (const task of tasksRef.current) {
      if (shownTaskIdsRef.current.has(task.id) && task.status !== "running") dismissTask(task.id);
    }
    shownTaskIdsRef.current = new Set();
  }, [dismissTask]);

  // While a deck is open here its progress shows in the conversation, so the
  // global toast skips it; leaving hands unfinished tasks back to the toast.
  useEffect(() => {
    setInlineProjectId(projectId);
    return () => setInlineProjectId(null);
  }, [projectId, setInlineProjectId]);
  useEffect(() => dismissShownTasks, [dismissShownTasks]);

  /** Close the undo window, either reversing the action or making it final. */
  const finishUndoWindow = useCallback((outcome: "undo" | "commit") => {
    const action = undoActionRef.current;
    if (!action) return;
    window.clearTimeout(action.timer);
    undoActionRef.current = null;
    setUndoMessage(null);
    action[outcome]();
  }, []);

  /** Show the undo toast; a new action makes any earlier one final. */
  const offerUndo = useCallback(
    (message: string, action: { undo: () => void; commit: () => void }) => {
      finishUndoWindow("commit");
      undoActionRef.current = {
        ...action,
        timer: window.setTimeout(() => finishUndoWindow("commit"), UNDO_WINDOW_MS),
      };
      setUndoMessage(message);
    },
    [finishUndoWindow],
  );

  /** Save a pending conversation change now rather than after the settle delay. */
  const flushConversationSave = useCallback(() => {
    const pending = conversationSaveRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.save();
  }, []);

  // Leaving the page shouldn't lose a save, or leave a deletion half done.
  useEffect(() => {
    const settle = () => {
      finishUndoWindow("commit");
      flushConversationSave();
    };
    window.addEventListener("pagehide", settle);
    return () => {
      window.removeEventListener("pagehide", settle);
      settle();
    };
  }, [finishUndoWindow, flushConversationSave]);

  /** Forget the conversation and edit scope (deck switch / new deck). */
  const resetConversation = useCallback(
    (options: { keepDraft?: boolean } = {}) => {
      finishUndoWindow("commit");
      flushConversationSave();
      conversationDeckRef.current = null;
      lastSavedConversationRef.current = null;
      dismissShownTasks();
      setThread([]);
      setThreadTasks(new Map());
      if (!options.keepDraft) {
        setDraftText("");
        setAttachments([]);
      }
      setIntentOverride(null);
      setAssistantCardId(null);
      setEditRunning(false);
      setPulseIds(new Set());
      setPanelTab("cards");
      setNarrowPane("chat");
      pendingGenerationsRef.current = [];
      assistantSnapshotRef.current = new Map();
    },
    [dismissShownTasks, finishUndoWindow, flushConversationSave],
  );

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
        const res = await apiFetch(`/api/browse/cards?${params}`, {
          credentials: "include",
        });
        const data = await readJson<{ cards: BrowseCardRow[]; total: number }>(res);
        const hidden = hiddenCardIdsRef.current;
        const nextCards = data.cards.map(browseRowToDraft).filter((card) => !hidden.has(card.id));
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
        setTotalCards(Math.max(0, data.total - hidden.size));
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

  const loadConversation = useCallback(async (deckId: string) => {
    let saved: unknown = null;
    try {
      const res = await apiFetch(`/api/projects/${deckId}/conversation`, {
        credentials: "include",
      });
      saved = (await readJson<{ conversation: unknown }>(res)).conversation;
    } catch {
      // A deck still opens without its history.
    }
    if (projectIdRef.current !== deckId) return;
    const restored = restoreConversation(saved);
    if (restored) {
      lastSavedConversationRef.current = JSON.stringify(saved);
      setThreadTasks(restored.tasks);
      // Messages sent while this loaded come after the saved ones.
      setThread((prev) => [...restored.messages, ...prev]);
    }
    conversationDeckRef.current = deckId;
  }, []);

  const applyChoice = useCallback((choice: GenerationChoice) => {
    setDetailLevel(choice.detailLevel);
    setQualityLevel(choice.qualityLevel);
    setSelectedTypes(new Set<GenerationCardType>(choice.cardTypes.length ? choice.cardTypes : ["basic"]));
    setFocusPreset(choice.focusPreset);
    setClozeHints(choice.clozeHints);
    setAutoTags(choice.autoTags);
  }, []);

  // Storage is read after mount so the server and first client render agree.
  useEffect(() => {
    if (initialDeckId) return;
    const stored = readNewDeckChoice(DEFAULT_FOCUS_PRESET);
    if (!stored) return;
    applyChoice({
      ...stored,
      detailLevel: initialComposer?.detail ?? stored.detailLevel,
      focusPreset: initialComposer?.focus ?? stored.focusPreset,
    });
    // Only on mount: later switches go through startNewDeck / activateExistingDeck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // A reload of the deck already open (e.g. right after it was created)
      // keeps its conversation; switching decks starts a fresh one.
      const switching = projectIdRef.current !== deckId;
      if (switching) resetConversation({ keepDraft: true });
      projectIdRef.current = deckId;
      if (switching) void loadConversation(deckId);

      const loadSettings = async () => {
        try {
          const projRes = await apiFetch(`/api/projects/${deckId}`, {
            credentials: "include",
          });
          const project = await readJson<{
            settings?: unknown;
            deck_name?: string | null;
            name?: string | null;
          }>(projRes);
          setDeckName(project.deck_name ?? project.name ?? "");
          const saved = choiceFromSettings(project.settings, DEFAULT_FOCUS_PRESET);
          // Choices made on the deck page win over the deck's saved settings, once.
          const fromLink = linkedComposerRef.current;
          linkedComposerRef.current = undefined;
          if (fromLink?.intent) setIntentOverride(fromLink.intent);
          applyChoice({
            ...saved,
            detailLevel: fromLink?.detail ?? saved.detailLevel,
            focusPreset: fromLink?.focus ?? saved.focusPreset,
          });
        } catch {
          // Keep deck name from list if project fetch fails.
        }
      };

      // Soft card load avoids the full-list skeleton flash when toggling decks.
      // Cards start with the settings fetch, not after it, or the deck reads as
      // empty until they begin.
      await Promise.all([
        loadSettings(),
        loadDeckCards(deckId, { soft: true }),
        loadProjectSources(deckId),
      ]);
    },
    [applyChoice, loadConversation, loadDeckCards, loadProjectSources, resetConversation],
  );

  const startNewDeck = useCallback(() => {
    setProjectId(null);
    setDeckName("");
    setCards([]);
    setTotalCards(0);
    setFocusedId(null);
    setSelectedIds(new Set());
    resetConversation();
    projectIdRef.current = null;
    setSources([]);
    setActiveSourceId(null);
    // A new deck starts from the last choices made for a new deck.
    applyChoice(readNewDeckChoice(DEFAULT_FOCUS_PRESET) ?? DEFAULT_CHOICE);
    setError(null);
  }, [applyChoice, resetConversation]);

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
        // A deck opened or created on this page is already loaded; only the URL caught up.
        if (
          initialDeckId &&
          initialDeckId !== projectIdRef.current &&
          decks.some((d) => d.id === initialDeckId)
        ) {
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

  // Sidebar "Create" lands here with no deck: go back to the start screen.
  const previousDeckParamRef = useRef(initialDeckId);
  useEffect(() => {
    const previous = previousDeckParamRef.current;
    previousDeckParamRef.current = initialDeckId;
    if (previous && !initialDeckId) startNewDeck();
  }, [initialDeckId, startNewDeck]);

  async function handleDeckChange(value: string) {
    if (value === NEW_DECK_VALUE) {
      startNewDeck();
      router.replace("/create");
      return;
    }
    const opening = activateExistingDeck(value, existingDecks);
    router.replace(`/create?deck=${value}`);
    await opening;
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

  const currentChoice: GenerationChoice = {
    detailLevel,
    qualityLevel,
    cardTypes: textCardTypes,
    focusPreset,
    clozeHints,
    autoTags,
  };
  const currentChoiceRef = useRef(currentChoice);
  currentChoiceRef.current = currentChoice;
  const choiceSaveRef = useRef<{ deckId: string; timer: number } | null>(null);

  /**
   * Called only from the controls, so loading a deck's settings never counts as a
   * change. An open deck saves the choice to itself; a new deck remembers it for
   * the next new deck.
   */
  const rememberChoice = useCallback((patch: Partial<GenerationChoice>) => {
    const next = { ...currentChoiceRef.current, ...patch };
    const deckId = projectIdRef.current;
    if (!deckId) {
      writeNewDeckChoice(next);
      return;
    }
    const pending = choiceSaveRef.current;
    if (pending && pending.deckId === deckId) window.clearTimeout(pending.timer);
    const timer = window.setTimeout(() => {
      if (choiceSaveRef.current?.timer === timer) choiceSaveRef.current = null;
      void apiFetch(`/api/projects/${deckId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: choiceSettingsPatch(next) }),
      }).catch(() => {
        // The next generation run saves the deck's settings again.
      });
    }, CHOICE_SAVE_DELAY_MS);
    choiceSaveRef.current = { deckId, timer };
  }, []);

  const toggleCardType = useCallback(
    (value: GenerationCardType) => {
      const next = new Set(selectedTypes);
      if (next.has(value)) {
        if (next.size === 1) return; // always keep at least one type
        next.delete(value);
      } else {
        next.add(value);
      }
      setSelectedTypes(next);
      rememberChoice({
        cardTypes: GENERATION_CARD_TYPE_OPTIONS.filter((o) => next.has(o.value)).map((o) => o.value),
      });
    },
    [selectedTypes, rememberChoice],
  );

  const settings = useMemo(
    () => ({
      cardMix: textCardTypes[0] ?? "basic",
      cardTypes: textCardTypes,
      clozeHints: clozeSelected ? clozeHints : false,
      autoTags,
      detailLevel,
      qualityLevel,
      focusPreset,
    }),
    [textCardTypes, clozeSelected, clozeHints, autoTags, detailLevel, qualityLevel, focusPreset],
  );

  const topbarDeckLabel = useMemo(() => {
    const fromList = existingDecks.find((d) => d.id === projectId)?.name;
    return (deckName ?? "").trim() || fromList || (projectId ? "Deck" : "New deck");
  }, [deckName, existingDecks, projectId]);

  /** Generation, a source upload, or an edit is in flight for this deck. */
  const working = generating || sourceTaskRunning || editRunning;

  const appendThread = useCallback((...messages: ThreadMessage[]) => {
    setThread((prev) => [...prev, ...messages]);
  }, []);

  /** Tasks the conversation is already reporting on. */
  const threadTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of thread) {
      if (message.role === "assistant" && message.kind === "tasks") {
        for (const id of message.taskIds) ids.add(id);
      }
    }
    return ids;
  }, [thread]);

  // Remember the latest state of each task in the thread, so its outcome stays
  // visible after the task is dismissed from the global list.
  useEffect(() => {
    if (threadTaskIds.size === 0) return;
    for (const id of threadTaskIds) shownTaskIdsRef.current.add(id);
    setThreadTasks((prev) => {
      let next: Map<string, BackgroundTask> | null = null;
      for (const task of tasks) {
        if (!threadTaskIds.has(task.id) || prev.get(task.id) === task) continue;
        next ??= new Map(prev);
        next.set(task.id, task);
      }
      return next ?? prev;
    });
  }, [tasks, threadTaskIds]);

  // Refresh cards/sources when background tasks for this deck complete.
  const syncedTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!projectId) return;
    const completed = tasks.filter(
      (task) =>
        (task.kind === "generation" || task.kind === "source") &&
        task.projectId === projectId &&
        task.status === "ready" &&
        !syncedTaskIdsRef.current.has(task.id),
    );
    if (completed.length === 0) return;
    for (const task of completed) syncedTaskIdsRef.current.add(task.id);

    const generated = completed.some((task) => task.kind === "generation");
    const addedSource = completed.find((task) => task.kind === "source");
    void loadProjectSources(
      projectId,
      generated ? undefined : { selectSourceId: addedSource?.sourceId ?? null },
    );
    if (!generated) return;

    const previousIds = new Set(cardsRef.current.map((c) => c.id));
    void (async () => {
      const nextCards = await loadDeckCards(projectId, {
        soft: true,
        preserveLoaded: true,
      });
      const newIds = nextCards.filter((c) => !previousIds.has(c.id)).map((c) => c.id);
      if (newIds.length > 0) {
        setPanelTab("cards");
        flashCardIds(newIds);
        scrollCardIntoView(newIds[0]!);
      }
    })();
  }, [
    flashCardIds,
    loadDeckCards,
    loadProjectSources,
    projectId,
    scrollCardIntoView,
    tasks,
  ]);

  // Failed tasks the conversation isn't showing (started elsewhere or before
  // a reload) surface in the page error banner instead.
  const reportedFailuresRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!projectId) return;
    const failed = tasks.find(
      (task) =>
        (task.kind === "generation" || task.kind === "source") &&
        task.projectId === projectId &&
        task.status === "failed" &&
        !reportedFailuresRef.current.has(task.id),
    );
    if (!failed) return;
    reportedFailuresRef.current.add(failed.id);
    if (threadTaskIds.has(failed.id)) return;
    setError(failed.error?.trim() || `${failed.title} failed. Please try again.`);
  }, [projectId, tasks, threadTaskIds]);

  // Cards are saved section by section during a run: pull them in as the count grows.
  const streamedCountsRef = useRef<Map<string, number>>(new Map());
  const streamRefreshingRef = useRef(false);
  useEffect(() => {
    if (!projectId || streamRefreshingRef.current) return;
    const grown = tasks.find(
      (task) =>
        task.kind === "generation" &&
        task.projectId === projectId &&
        task.status === "running" &&
        (task.cardsAdded ?? 0) > (streamedCountsRef.current.get(task.id) ?? 0),
    );
    if (!grown) return;
    streamedCountsRef.current.set(grown.id, grown.cardsAdded ?? 0);
    streamRefreshingRef.current = true;
    const previousIds = new Set(cardsRef.current.map((c) => c.id));
    void loadDeckCards(projectId, { soft: true, preserveLoaded: true })
      .then((nextCards) => {
        const newIds = nextCards.filter((c) => !previousIds.has(c.id)).map((c) => c.id);
        if (newIds.length > 0) flashCardIds(newIds);
      })
      .finally(() => {
        streamRefreshingRef.current = false;
      });
  }, [flashCardIds, loadDeckCards, projectId, tasks]);

  // Keep this deck's conversation saved as it changes.
  useEffect(() => {
    const deckId = conversationDeckRef.current;
    if (!deckId || deckId !== projectId) return;
    const body = JSON.stringify(serializeConversation(thread, threadTasks));
    if (body === lastSavedConversationRef.current) return;
    if (conversationSaveRef.current) window.clearTimeout(conversationSaveRef.current.timer);
    const save = () => {
      conversationSaveRef.current = null;
      lastSavedConversationRef.current = body;
      void apiFetch(`/api/projects/${deckId}/conversation`, {
        method: "PUT",
        credentials: "include",
        keepalive: body.length < 60_000,
        headers: { "Content-Type": "application/json" },
        body: `{"conversation":${body}}`,
      }).catch(() => {
        // The conversation is a convenience: losing a save never blocks the work.
      });
    };
    conversationSaveRef.current = {
      timer: window.setTimeout(save, CONVERSATION_SAVE_DELAY_MS),
      save,
    };
  }, [projectId, thread, threadTasks]);

  // Sources sent together: once every upload has settled, one generation run
  // covers all the sources that made it.
  useEffect(() => {
    if (pendingGenerationsRef.current.length === 0) return;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const waiting: PendingGeneration[] = [];
    for (const pending of pendingGenerationsRef.current) {
      const sourceTasks = pending.sourceTaskIds.map((id) => byId.get(id));
      if (sourceTasks.some((task) => task?.status === "running")) {
        waiting.push(pending);
        continue;
      }
      const ready = sourceTasks.filter(
        (task): task is BackgroundTask => task?.status === "ready" && Boolean(task.sourceId),
      );
      const taskId =
        ready.length > 0
          ? startMultiSourceGeneration({
              projectId: pending.projectId,
              deckName: pending.deckName,
              settings: pending.settings,
              sources: ready.map((task) => ({
                id: task.sourceId!,
                title: task.title,
              })),
            })
          : null;
      if (taskId) setActiveTaskId(taskId);
      setThread((prev) =>
        prev.map((message) =>
          message.id === pending.messageId &&
          message.role === "assistant" &&
          message.kind === "tasks"
            ? {
                ...message,
                taskIds: taskId ? [...message.taskIds, taskId] : message.taskIds,
                labels: taskId
                  ? {
                      ...message.labels,
                      [taskId]: plural(ready.length, "source"),
                    }
                  : message.labels,
                pendingGeneration: false,
              }
            : message,
        ),
      );
    }
    pendingGenerationsRef.current = waiting;
  }, [startMultiSourceGeneration, tasks]);

  /** Create the deck row (used by the first message + manual cards). */
  const createProject = useCallback(
    async (suggestedName: string): Promise<string> => {
      const name = fitDeckName(suggestedName, "New deck");
      const res = await apiFetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, deck_name: name, settings }),
      });
      const project = await readJson<{ id: string }>(res);
      posthog.capture("deck_created", { deck_id: project.id });
      projectIdRef.current = project.id;
      conversationDeckRef.current = project.id;
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

  /** One run's settings: the deck's settings plus this message's instructions. */
  const runSettings = useCallback(
    (instructions: string): Partial<GenerationSettings> => ({
      ...settings,
      customInstructions: instructions.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS),
    }),
    [settings],
  );

  /** Start the upload/import for one composer attachment. */
  const startAttachmentTask = useCallback(
    (
      attachment: ComposerAttachment,
      base: {
        projectId: string;
        deckName: string;
        settings: Partial<GenerationSettings>;
        /** One-shot add + generate; otherwise just persist the source. */
        generate: boolean;
      },
    ): string => {
      switch (attachment.kind) {
        case "text":
          return startDeckGeneration({
            ...base,
            sourceMode: "text",
            text: attachment.text,
            file: null,
          });
        case "document":
          return startDeckGeneration({
            ...base,
            sourceMode: "document",
            file: attachment.file,
            extractImages: attachment.extractImages,
          });
        case "video":
          return startDeckGeneration({
            ...base,
            sourceMode: "video",
            videoInputMode: "upload",
            file: attachment.file,
          });
        case "youtube":
          return startDeckGeneration({
            ...base,
            sourceMode: "video",
            videoInputMode: "youtube",
            youtubeUrl: attachment.url,
            file: null,
          });
        case "website":
          return startDeckGeneration({
            ...base,
            sourceMode: "website",
            websiteUrl: attachment.url,
            file: null,
          });
        case "drive":
          return startDeckGeneration({
            ...base,
            sourceMode: "google-drive",
            googleDriveFileId: attachment.file.id,
            googleDriveFileName: attachment.file.name,
            file: null,
          });
        case "notion":
          return startDeckGeneration({
            ...base,
            sourceMode: "notion",
            notionPageId: attachment.page.id,
            notionPageTitle: attachment.page.title,
            file: null,
          });
      }
    },
    [startDeckGeneration],
  );

  /** Add the composer's sources to the deck, optionally writing cards from them. */
  const sendSources = useCallback(
    async (pending: ComposerAttachment[], message: string, generate: boolean) => {
      const instructions = generate ? message : "";
      const fallbackName = suggestDeckName(pending, message);
      let pid = projectId;
      try {
        if (!pid) pid = await createProject(fallbackName);
      } catch (err) {
        setError(friendlyError(err, "Could not create the deck"));
        return;
      }
      const base = {
        projectId: pid,
        deckName:
          (deckName ?? "").trim() ||
          existingDecks.find((deck) => deck.id === pid)?.name ||
          fallbackName,
        settings: runSettings(instructions),
      };
      // One source generates in a single pass. Several are stored first, so one
      // generation run can cover them all once they have finished processing.
      const oneShot = generate && pending.length === 1;
      const taskIds = pending.map((attachment) =>
        startAttachmentTask(attachment, { ...base, generate: oneShot }),
      );
      const replyId = messageId();
      appendThread(
        {
          id: messageId(),
          role: "user",
          text: instructions,
          sources: pending.map((attachment) => ({
            icon: attachmentIcon(attachment),
            label: attachmentTitle(attachment),
          })),
        },
        {
          id: replyId,
          role: "assistant",
          kind: "tasks",
          taskIds,
          pendingGeneration: generate && !oneShot,
          labels: Object.fromEntries(
            taskIds.map((taskId, index) => [taskId, attachmentTitle(pending[index]!)]),
          ),
        },
      );
      if (oneShot) {
        setActiveTaskId(taskIds[0]!);
      } else if (generate) {
        pendingGenerationsRef.current.push({
          messageId: replyId,
          ...base,
          sourceTaskIds: taskIds,
        });
      }
      setAttachments([]);
      if (generate) setDraftText("");
      setIntentOverride(null);
    },
    [
      appendThread,
      createProject,
      deckName,
      existingDecks,
      projectId,
      runSettings,
      startAttachmentTask,
    ],
  );

  /**
   * Generate from sources already in the deck. By default that's the ones that
   * haven't been used yet; an instruction can apply to any of them, so it covers all.
   */
  const generateFromDeckSources = useCallback(
    (instructions: string, chosen?: DeckSource[]) => {
      if (!projectId || sources.length === 0) return;
      setError(null);
      const unused = sources.filter((source) => source.cardCount === 0);
      const targets = chosen ?? (!instructions && unused.length > 0 ? unused : sources);
      const label = targets.length === 1 ? targets[0]!.title : plural(targets.length, "source");
      const taskId = startMultiSourceGeneration({
        projectId,
        deckName: topbarDeckLabel,
        settings: runSettings(instructions),
        sources: targets.map((source) => ({ id: source.id, title: source.title })),
      });
      setActiveTaskId(taskId);
      appendThread(
        {
          id: messageId(),
          role: "user",
          text: instructions || `Generate cards from ${label}.`,
          sources: [],
        },
        {
          id: messageId(),
          role: "assistant",
          kind: "tasks",
          taskIds: [taskId],
          labels: { [taskId]: label },
        },
      );
    },
    [appendThread, projectId, runSettings, sources, startMultiSourceGeneration, topbarDeckLabel],
  );

  /** No source at all: the message itself is the topic. Returns false if nothing started. */
  const generateFromTopic = useCallback(
    async (topic: string): Promise<boolean> => {
      if (topic.length < 3) {
        setError("Describe the topic in at least 3 characters.");
        return false;
      }
      const fallbackName = suggestDeckName([], topic);
      let pid = projectId;
      try {
        if (!pid) pid = await createProject(fallbackName);
      } catch (err) {
        setError(friendlyError(err, "Could not create the deck"));
        return false;
      }
      // Topic decks have no stored source; generation starts right away.
      const taskId = startDeckGeneration({
        projectId: pid,
        deckName: (deckName ?? "").trim() || fallbackName,
        settings: runSettings(""),
        sourceMode: "topic",
        topicQuery: topic,
        file: null,
      });
      setActiveTaskId(taskId);
      appendThread(
        { id: messageId(), role: "user", text: topic, sources: [] },
        {
          id: messageId(),
          role: "assistant",
          kind: "tasks",
          taskIds: [taskId],
          topic: true,
        },
      );
      return true;
    },
    [appendThread, createProject, deckName, projectId, runSettings, startDeckGeneration],
  );

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
        settings: runSettings(""),
        existingSourceId: activeSource.id,
        scopeText: trimmed,
        sourceMode: "document",
        file: null,
      });
      setActiveTaskId(taskId);
      appendThread(
        {
          id: messageId(),
          role: "user",
          text: "Write cards from the passage I selected.",
          sources: [{ icon: "ri-mark-pen-line", label: activeSource.title }],
        },
        {
          id: messageId(),
          role: "assistant",
          kind: "tasks",
          taskIds: [taskId],
          labels: { [taskId]: `a passage in ${activeSource.title}` },
        },
      );
    },
    [
      activeSource,
      appendThread,
      projectId,
      generating,
      textCardTypes.length,
      startDeckGeneration,
      deckName,
      topbarDeckLabel,
      runSettings,
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

  /**
   * Delete cards with a short undo window: they leave the list now and the
   * server delete happens when the window closes.
   */
  const requestCardDelete = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      finishUndoWindow("commit");
      const idSet = new Set(ids);
      const removed = cardsRef.current.flatMap((card, index) =>
        idSet.has(card.id) ? [{ card, index }] : [],
      );
      const deckId = projectIdRef.current;
      for (const id of ids) hiddenCardIdsRef.current.add(id);
      removeCardsLocally(idSet);
      if (focusedId && idSet.has(focusedId)) {
        setOverlayOpen(false);
        setFocusedId(null);
      }

      const reveal = () => {
        for (const id of ids) hiddenCardIdsRef.current.delete(id);
      };
      const restore = () => {
        reveal();
        if (projectIdRef.current !== deckId) return;
        setCards((prev) => {
          const next = [...prev];
          for (const { card, index } of removed) next.splice(Math.min(index, next.length), 0, card);
          return next;
        });
        setTotalCards((n) => n + removed.length);
        flashCardIds(ids);
      };

      offerUndo(ids.length === 1 ? "Card deleted" : `${ids.length} cards deleted`, {
        undo: restore,
        commit: () => {
          void (async () => {
            try {
              for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
                const res = await apiFetch("/api/browse/batch", {
                  method: "POST",
                  credentials: "include",
                  keepalive: true,
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "delete",
                    card_ids: ids.slice(i, i + DELETE_BATCH_SIZE),
                  }),
                });
                if (!res.ok) throw new Error(await res.text());
              }
              reveal();
            } catch (err) {
              restore();
              setError(friendlyError(err, "Could not delete those cards."));
            }
          })();
        },
      });
    },
    [finishUndoWindow, flashCardIds, focusedId, offerUndo, removeCardsLocally],
  );

  /** Clear the conversation, with the same undo window as deleting cards. */
  const clearConversation = useCallback(() => {
    const previousThread = thread;
    const previousTasks = threadTasks;
    setThread([]);
    setThreadTasks(new Map());
    offerUndo("Conversation cleared", {
      undo: () => {
        setThread(previousThread);
        setThreadTasks(previousTasks);
      },
      commit: () => undefined,
    });
  }, [offerUndo, thread, threadTasks]);

  // --- Card edits from the conversation ------------------------------------

  /** Cards a text-only edit message applies to: one card, the selection, or all. */
  const editScope = useMemo(() => {
    if (assistantCardId) {
      const card = cards.find((c) => c.id === assistantCardId);
      if (card) {
        return {
          kind: "card" as const,
          ids: [card.id] as string[] | undefined,
          label: `This card: ${cardScopePreview(card)}`,
          noun: "this card",
        };
      }
    }
    if (selectedIds.size > 0) {
      const label = `${selectedIds.size} selected ${selectedIds.size === 1 ? "card" : "cards"}`;
      return {
        kind: "selection" as const,
        ids: [...selectedIds] as string[] | undefined,
        label,
        noun: label,
      };
    }
    const label = `all ${plural(projectId ? totalCards : cards.length, "card")}`;
    return {
      kind: "all" as const,
      ids: undefined as string[] | undefined,
      label,
      noun: label,
    };
  }, [assistantCardId, cards, projectId, selectedIds, totalCards]);

  const patchEditMessage = useCallback(
    (id: string, patch: Partial<Extract<ThreadMessage, { kind: "edit" }>>) => {
      setThread((prev) =>
        prev.map((message) =>
          message.id === id && message.role === "assistant" && message.kind === "edit"
            ? { ...message, ...patch }
            : message,
        ),
      );
    },
    [],
  );

  const runAssistant = useCallback(
    async (instruction: string) => {
      if (!projectId || editRunning) return;
      const scope = editScope;
      const scopeIds = scope.ids;

      // Snapshot the loaded cards in scope so Undo can restore them. Cards not
      // yet paginated in are covered when the response arrives (see below).
      const inScope = scopeIds
        ? cardsRef.current.filter((c) => scopeIds.includes(c.id))
        : cardsRef.current;
      const snapshot = new Map<string, AssistantSnapshot>();
      for (const card of inScope) snapshot.set(card.id, snapshotOf(card));

      const replyId = messageId();
      setThread((prev) => [
        // Only the most recent edit can be undone.
        ...prev.map((message) =>
          message.role === "assistant" && message.kind === "edit" && message.canUndo
            ? { ...message, canUndo: false }
            : message,
        ),
        {
          id: messageId(),
          role: "user",
          text: instruction,
          sources: [],
          scope: scope.kind === "all" ? undefined : scope.label,
        },
        {
          id: replyId,
          role: "assistant",
          kind: "edit",
          status: "running",
          scopeLabel: scope.noun,
        },
      ]);
      setEditRunning(true);
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
          setPanelTab("cards");
          flashCardIds(result.updated.map((row) => row.id));
        }
        posthog.capture("card_assistant_edit", {
          deck_id: projectId,
          scope: scope.kind,
          in_scope: result.scope,
          updated: result.updated.length,
        });
        patchEditMessage(replyId, {
          status: "done",
          updated: result.updated.length,
          summary: result.summary?.trim() ?? "",
          canUndo: undoSnapshot.size > 0,
        });
      } catch (err) {
        patchEditMessage(replyId, {
          status: "error",
          error: friendlyError(err, "The assistant could not edit these cards."),
        });
      } finally {
        setPulseIds(new Set());
        setEditRunning(false);
        // A single-card scope is one-shot; a selection stays for follow-ups.
        setAssistantCardId(null);
      }
    },
    [editRunning, editScope, flashCardIds, patchEditMessage, projectId],
  );

  const undoAssistant = useCallback(
    async (editMessageId: string) => {
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
          `Restored ${restored.length} of ${entries.length} cards. ${failed.length} could not be reverted.`,
        );
      }
      patchEditMessage(editMessageId, {
        canUndo: false,
        summary: `Reverted ${plural(restored.length, "card")}.`,
      });
    },
    [assistantUndoing, flashCardIds, patchEditMessage],
  );

  /** Point the composer at the cards to rewrite (selection toolbar / card sparkle). */
  const focusComposerForEdit = useCallback((cardId: string | null) => {
    setAssistantCardId(cardId);
    setIntentOverride("edit");
    setNarrowPane("chat");
    composerRef.current?.focus();
  }, []);

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
          ? {
              type,
              cloze_text: "",
              extra: "",
              tags: [] as string[],
              append: false,
            }
          : type === "image-occlusion"
            ? { type, front: "", back: "", tags: [] as string[], append: false }
            : {
                type: "basic" as const,
                front: "",
                back: "",
                tags: [] as string[],
                append: false,
              };
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

  const handleViewSource = useCallback((target: { sourceId: string; snippet: string }) => {
    const sourceId = target.sourceId?.trim();
    if (!sourceId) return;
    setActiveSourceId(sourceId);
    void prefetchSourceDocument(sourceId);
    setViewTab("notes");
    setPanelTab("sources");
    setNarrowPane("panel");
    const text = (target.snippet ?? "").trim();
    if (text) {
      setSourceScrollTarget({ text, nonce: Date.now() });
    }
  }, []);

  // "Show in source" from the study window: once the deck's cards are loaded,
  // focus the card and scroll its source to the card's evidence quote.
  const pendingCardFocusRef = useRef<string | null>(initialCardId);
  useEffect(() => {
    const cardId = pendingCardFocusRef.current;
    if (!cardId || !projectId || cardsLoading) return;
    pendingCardFocusRef.current = null;
    const loaded = cards.find((c) => c.id === cardId);
    if (loaded) setFocusedId(cardId);
    void (async () => {
      let quote = loaded?.source_quote ?? null;
      let sourceId = initialSourceId;
      if (!quote || !sourceId) {
        try {
          const res = await apiFetch(`/api/cards/${cardId}/explain?kind=explain`);
          if (res.ok) {
            const state = (await res.json()) as { source?: { id?: string | null; quote?: string | null } | null };
            quote = quote ?? state.source?.quote ?? null;
            sourceId = sourceId ?? state.source?.id ?? null;
          }
        } catch {
          // The source still opens, just without the scroll.
        }
      }
      if (sourceId) handleViewSource({ sourceId, snippet: quote ?? "" });
    })();
  }, [projectId, cardsLoading, cards, handleViewSource, initialSourceId]);

  const openSourceMenu = useCallback(() => {
    setNarrowPane("chat");
    composerRef.current?.openSourceMenu();
  }, []);

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
        setChatPanePct(stored);
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
      setChatPanePct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)));
    },
    [splitDragging],
  );

  const endSplitDrag = useCallback(() => {
    if (!splitDragging) return;
    setSplitDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setChatPanePct((pct) => {
      try {
        window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(pct * 10) / 10));
      } catch {
        // Ignore storage access issues.
      }
      return pct;
    });
  }, [splitDragging]);

  const handleSplitKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -SPLIT_KEY_STEP_PCT : SPLIT_KEY_STEP_PCT;
    setChatPanePct((pct) => {
      const next = Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct + step));
      try {
        window.localStorage.setItem(SPLIT_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage access issues.
      }
      return next;
    });
  }, []);

  const resetSplit = useCallback(() => {
    setChatPanePct(SPLIT_DEFAULT_PCT);
    try {
      window.localStorage.removeItem(SPLIT_STORAGE_KEY);
    } catch {
      // Ignore storage access issues.
    }
  }, []);

  const originalAvailable = activeSource ? sourceHasOriginal(activeSource) : false;
  const effectiveTab: SourceViewTab =
    viewTab === "original" && originalAvailable ? "original" : "notes";

  /** Sources dropdown in the Sources tab: hover peeks, click pins. */
  const sourcesFlyoutButton = (
    <SourcesFlyout
      sources={sources}
      activeSourceId={activeSourceId}
      disabled={generating}
      onSelect={(sourceId) => {
        setActiveSourceId(sourceId);
        void prefetchSourceDocument(sourceId);
      }}
      onAddSource={openSourceMenu}
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

  const cardCount = projectId ? totalCards : cards.length;
  const canEditCards = Boolean(projectId) && cardCount > 0;
  const scoped = editScope.kind !== "all" && attachments.length === 0;
  /** What a text-only message does: rewrite existing cards or write new ones. */
  const composerIntent: ComposerIntent =
    attachments.length > 0 || !canEditCards
      ? "generate"
      : scoped
        ? "edit"
        : (intentOverride ?? (GENERATE_INTENT_PATTERN.test(draftText) ? "generate" : "edit"));
  const showIntent = canEditCards && attachments.length === 0 && !scoped;
  /** Until the deck's cards arrive, a message can't tell an edit from a new topic. */
  const deckLoading =
    Boolean(projectId) && (cardsLoading || (cardsRefreshing && cards.length === 0));
  const canSend =
    !working &&
    !deckLoading &&
    (attachments.length > 0 ||
      draftText.trim().length > 0 ||
      (showIntent && composerIntent === "generate" && sources.length > 0));

  /** Running generations for this deck that can be stopped. */
  const stoppableTasks = tasks.filter(
    (task) =>
      task.kind === "generation" &&
      task.projectId === projectId &&
      task.status === "running" &&
      task.jobId,
  );
  const waitingToGenerate = thread.some(
    (message) =>
      message.role === "assistant" && message.kind === "tasks" && message.pendingGeneration,
  );

  async function handleStop() {
    setStopping(true);
    setError(null);
    try {
      // Sources still uploading finish and stay in the deck; only their generation is called off.
      pendingGenerationsRef.current = [];
      setThread((prev) =>
        prev.map((message) =>
          message.role === "assistant" && message.kind === "tasks" && message.pendingGeneration
            ? { ...message, pendingGeneration: false }
            : message,
        ),
      );
      await Promise.all(stoppableTasks.map((task) => stopGeneration(task.id, task.jobId!)));
    } catch (err) {
      setError(friendlyError(err, "Could not stop generating. Please try again."));
    } finally {
      setStopping(false);
    }
  }

  async function handleSend() {
    if (working || deckLoading) return;
    setError(null);
    const message = draftText.trim();
    // A message too long to be an instruction is study material in its own right.
    if (message.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
      await sendSources(
        [...attachments, { id: newAttachmentId(), kind: "text", text: message }],
        "",
        true,
      );
      return;
    }
    if (attachments.length > 0) {
      await sendSources(attachments, message, true);
      return;
    }
    if (composerIntent === "edit") {
      if (!message) return;
      setDraftText("");
      await runAssistant(message);
      return;
    }
    if (projectId && sources.length > 0) {
      generateFromDeckSources(message);
      setDraftText("");
      setIntentOverride(null);
      return;
    }
    if (message && (await generateFromTopic(message))) {
      setDraftText("");
      setIntentOverride(null);
    }
  }

  // A prompt sent from Home or a deck page runs as soon as the deck has loaded.
  useEffect(() => {
    if (!initialPrompt || working || deckLoading) return;
    if (consumeAutoSend(initialPrompt)) void handleSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, working, deckLoading]);

  const controls: GenerationControls = {
    detailLevel,
    onDetailLevelChange: (value) => {
      setDetailLevel(value);
      rememberChoice({ detailLevel: value });
    },
    qualityLevel,
    onQualityLevelChange: (value) => {
      setQualityLevel(value);
      rememberChoice({ qualityLevel: value });
    },
    selectedTypes,
    onToggleCardType: toggleCardType,
    focusPreset,
    onFocusPresetChange: (value) => {
      setFocusPreset(value);
      rememberChoice({ focusPreset: value });
    },
    clozeHints,
    onClozeHintsChange: (value) => {
      setClozeHints(value);
      rememberChoice({ clozeHints: value });
    },
    autoTags,
    onAutoTagsChange: (value) => {
      setAutoTags(value);
      rememberChoice({ autoTags: value });
    },
  };

  const workingLabel = editRunning
    ? "Editing cards…"
    : generating
      ? "Generating cards…"
      : "Adding your source…";

  const composerProps = {
    ref: composerRef,
    text: draftText,
    onTextChange: setDraftText,
    attachments,
    onAttachmentsChange: setAttachments,
    controls,
    canSend,
    working,
    workingLabel,
    onStop: stoppableTasks.length > 0 || waitingToGenerate ? () => void handleStop() : undefined,
    stopping,
    returnTo: projectId ? `/create?deck=${projectId}` : "/create",
    onSend: () => void handleSend(),
    onAddSourcesOnly: () => void sendSources(attachments, draftText.trim(), false),
    onImport: openDeckImport,
  };

  const errorBanner = error ? (
    <div className="notice notice-error dhc-notice" role="alert">
      <i className="ri-error-warning-line" aria-hidden />
      <span style={{ flex: 1, minWidth: 0 }}>
        {isAiCreditsExhaustedMessage(error) ? AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE : error}
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
        className="dhc-error__close"
        onClick={() => setError(null)}
        aria-label="Dismiss error"
      >
        <i className="ri-close-line" />
      </button>
    </div>
  ) : null;

  /** Cards / Sources switch that heads the right-hand panel. */
  const panelTabs = (
    <div className="dhc-panel-tabs">
      <div className="dh-seg" role="tablist" aria-label="Deck contents">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "cards"}
          onClick={() => setPanelTab("cards")}
        >
          Cards {cardsLoading ? "…" : cardCount}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === "sources"}
          onClick={() => setPanelTab("sources")}
        >
          Sources {sources.length}
        </button>
      </div>
      {generating ? (
        <span className="dhc-panel-tabs__writing" role="status">
          <WorkingBars />
          Generating…
        </span>
      ) : null}
    </div>
  );

  const threadIntro =
    thread.length === 0 ? (
      <div className="dhc-intro">
        {deckLoading
          ? <SkeletonBar width="60%" height={14} />
          : cardCount > 0
            ? `${plural(cardCount, "card")}${
                sources.length > 0 ? ` from ${plural(sources.length, "source")}` : ""
              }. Tell me what to change, add another source, or ask for more cards.`
            : sources.length > 0
              ? `${plural(sources.length, "source")} ready. Send a message to generate cards from ${
                  sources.length === 1 ? "it" : "them"
                }, with any instructions you like.`
              : "This deck is empty. Add a source or name a topic to generate cards."}
      </div>
    ) : null;

  const showSuggestions =
    canEditCards && !working && attachments.length === 0 && draftText.length === 0;

  const sourcesPanel = (
    <>
      <div className="dh-create-cards-header">
        <div style={s.panelHeaderRow}>
          {panelTabs}
          <div className="dh-create-cards-header__actions">
            {sources.length > 0 ? (
              <GenerateSourcesButton
                sources={sources}
                activeSourceId={activeSourceId}
                disabled={working}
                generating={generating}
                disabledReason={
                  sourceTaskRunning ? "Wait for the source to finish processing." : undefined
                }
                onGenerate={(chosen) => generateFromDeckSources("", chosen)}
              />
            ) : null}
          </div>
        </div>
      </div>
      {activeSource ? (
        <>
          <div className="dhc-source-bar">
            {sourcesFlyoutButton}
            {originalAvailable || activeSource.externalUrl ? (
              <div className="dh-seg" role="tablist" aria-label="Source view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveTab === "notes"}
                  onClick={() => setViewTab("notes")}
                >
                  Text
                </button>
                {originalAvailable ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveTab === "original"}
                    onClick={() => setViewTab("original")}
                  >
                    Original
                  </button>
                ) : null}
                {activeSource.externalUrl ? (
                  <a
                    href={activeSource.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="dhc-seg-link"
                  >
                    Original
                    <i className="ri-external-link-line" aria-hidden />
                  </a>
                ) : null}
              </div>
            ) : null}
            {effectiveTab === "notes" ? (
              <button
                type="button"
                className="create-topbar-control create-topbar-control--icon"
                style={{ marginLeft: "auto" }}
                aria-pressed={showCardHighlights}
                aria-label="Highlight passages linked to cards"
                title={
                  showCardHighlights
                    ? "Hide passages linked to cards"
                    : "Highlight passages linked to cards"
                }
                onClick={() => setShowCardHighlightsPersisted(!showCardHighlights)}
              >
                <i className="ri-mark-pen-line create-topbar-control__icon" aria-hidden />
              </button>
            ) : null}
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
        <div style={s.sourceEmpty}>
          <div style={s.emptyAnchor}>
            <div style={s.emptyMain}>
              {sourceTaskRunning ? (
                <BrandMark size={40} animated title={null} />
              ) : (
                <i className="ri-file-text-line" style={s.emptyIcon} aria-hidden />
              )}
              <p style={s.emptyText}>
                {sourceTaskRunning
                  ? "Your source is being processed. It will appear here shortly."
                  : "Sources you add in the chat appear here, with the passages your cards came from."}
              </p>
            </div>
            {!sourceTaskRunning ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={s.emptyAction}
                onClick={openSourceMenu}
              >
                <i className="ri-add-line" aria-hidden />
                Add source
              </button>
            ) : null}
          </div>
        </div>
      )}
    </>
  );

  /** Opening a deck by URL: hold the start screen back until the deck resolves. */
  const booting = Boolean(initialDeckId) && decksLoading && !projectId;
  const showStart = !projectId && thread.length === 0;

  return (
    <div
      className="dhc-shell"
      style={s.shell}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files") || deckImportOpen) return;
        // Leave drops inside an editor (e.g. the source document) to that editor.
        if ((e.target as Element).closest?.("[contenteditable='true']")) return;
        e.preventDefault();
        setNarrowPane("chat");
        composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <PageHeaderSlot menuItems={headerMenuItems} />

      {booting ? (
        <div role="status" aria-label="Loading deck">
          <CreateStartSkeleton />
        </div>
      ) : showStart ? (
        <div className="dhc-start">
          <div className="dhc-start__inner">
            <h1 className="dhc-start__greeting dh-eq dh-eq-hover">
              <BrandMark size={40} title={null} className="dh-greet-mark" />
              {greetingName
                ? `What are we studying, ${greetingName}?`
                : "What are we studying today?"}
            </h1>
            {errorBanner}
            <CreateComposer
              {...composerProps}
              variant="start"
              placeholder="Name a topic, paste your notes, or add a source…"
              deckPicker={{
                label: "New deck",
                decks: existingDecks,
                onSelect: (deckId) => void handleDeckChange(deckId),
              }}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="dh-seg dhc-pane-switch" role="tablist" aria-label="Create panes">
            <button
              type="button"
              role="tab"
              aria-selected={narrowPane === "chat"}
              onClick={() => setNarrowPane("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={narrowPane === "panel"}
              onClick={() => setNarrowPane("panel")}
            >
              Deck
            </button>
          </div>

          <div
            ref={splitBodyRef}
            className="dhc-workspace"
            data-pane={narrowPane}
            style={{
              gridTemplateColumns: `minmax(320px, ${chatPanePct}fr) 1px minmax(340px, ${
                100 - chatPanePct
              }fr)`,
            }}
          >
            <section className="dhc-chat" aria-label="Conversation">
              <div className="dhc-chat__header">
                <DeckSwitcher
                  decks={existingDecks}
                  currentId={projectId}
                  label={topbarDeckLabel}
                  disabled={decksLoading || generating}
                  onSelect={(value) => void handleDeckChange(value)}
                />
                <span className="dh-spacer" />
                {thread.length > 0 && !working ? (
                  <button
                    type="button"
                    className="create-topbar-control create-topbar-control--icon"
                    aria-label="Clear conversation"
                    title="Clear conversation"
                    onClick={clearConversation}
                  >
                    <i className="ri-eraser-line create-topbar-control__icon" aria-hidden />
                  </button>
                ) : null}
                {projectId ? (
                  <DeckActionsMenu
                    deck={{
                      id: projectId,
                      title: topbarDeckLabel,
                      cardCount: totalCards,
                    }}
                    omit={["create"]}
                    variant="create-topbar"
                    align="right"
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
                      router.replace("/create");
                    }}
                    onPublish={(deckId) => router.push(`/decks/${deckId}`)}
                  />
                ) : null}
              </div>

              <CreateThread
                messages={thread}
                tasks={threadTasks}
                intro={threadIntro}
                undoing={assistantUndoing}
                onUndoEdit={(id) => void undoAssistant(id)}
                onOpenBilling={() => openSettings("billing")}
              />

              <div className="dhc-dock">
                {errorBanner}
                {showSuggestions ? (
                  <div className="dhc-suggest">
                    {ASSISTANT_EDIT_SUGGESTIONS.slice(0, EDIT_SUGGESTION_COUNT).map(
                      (suggestion) => (
                        <button
                          key={suggestion.label}
                          type="button"
                          className="dhc-shortcut"
                          onClick={() => {
                            setDraftText(suggestion.prompt);
                            setIntentOverride("edit");
                            composerRef.current?.focus();
                          }}
                        >
                          {suggestion.label}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
                <CreateComposer
                  {...composerProps}
                  variant="docked"
                  hideSettings={scoped}
                  placeholder={
                    scoped
                      ? `How should I change ${editScope.kind === "card" ? "this card" : "these cards"}?`
                      : !canEditCards
                        ? "Add a source, or name a topic to generate cards…"
                        : composerIntent === "generate"
                          ? "What should the new cards cover?"
                          : "Ask for changes, or add another source…"
                  }
                  scope={
                    scoped
                      ? {
                          label: editScope.label,
                          onClear: () => {
                            setAssistantCardId(null);
                            setSelectedIds(new Set());
                          },
                        }
                      : null
                  }
                  intent={
                    showIntent
                      ? {
                          value: composerIntent,
                          editLabel: `Edit ${editScope.label}`,
                          onChange: setIntentOverride,
                        }
                      : null
                  }
                />
              </div>
            </section>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize conversation and cards panes"
              aria-valuenow={Math.round(chatPanePct)}
              aria-valuemin={SPLIT_MIN_PCT}
              aria-valuemax={SPLIT_MAX_PCT}
              tabIndex={0}
              title="Drag to resize, double-click to reset"
              className="dhc-workspace__splitter"
              data-dragging={splitDragging}
              onPointerDown={handleSplitPointerDown}
              onPointerMove={handleSplitPointerMove}
              onPointerUp={endSplitDrag}
              onPointerCancel={endSplitDrag}
              onDoubleClick={resetSplit}
              onKeyDown={handleSplitKeyDown}
            >
              <span />
            </div>

            <section className="dhc-panel">
              {undoMessage ? (
                <div className="dhc-toast" role="status">
                  <span>{undoMessage}</span>
                  <button
                    type="button"
                    className="dhc-toast__undo"
                    onClick={() => finishUndoWindow("undo")}
                  >
                    Undo
                  </button>
                </div>
              ) : null}
              {panelTab === "sources" ? (
                sourcesPanel
              ) : (
                <CreateCardsPane
                  cards={cards}
                  totalCards={totalCards}
                  projectId={projectId}
                  cardsLoading={cardsLoading}
                  cardsRefreshing={cardsRefreshing}
                  loadingMoreCards={loadingMoreCards}
                  hasMoreCards={hasMoreCards}
                  busy={generating || editRunning}
                  focusedId={focusedId}
                  overlayOpen={overlayOpen}
                  flashIds={flashIds}
                  pulseIds={pulseIds}
                  actionBusy={cardActionBusy}
                  rewriteNotice={
                    regenNotice ? { id: regenNotice.id, action: regenNotice.action } : null
                  }
                  selectedIds={selectedIds}
                  generating={generating}
                  scopedCardId={assistantCardId}
                  studyHref={projectId && cardCount > 0 ? `/decks/${projectId}/study` : null}
                  titleSlot={panelTabs}
                  listScrollRef={listScrollRef}
                  loadMoreRef={loadMoreRef}
                  cardRowRefs={cardRowRefs}
                  onSelectionChange={setSelectedIds}
                  onOpenCard={(id) => {
                    setFocusedId(id);
                    setOverlayOpen(true);
                  }}
                  onCreateCard={(type) => void writeManualCard(type)}
                  onDeleteCard={(id) => requestCardDelete([id])}
                  onDeleteSelected={() => requestCardDelete([...selectedIds])}
                  onAssistCard={(id) => focusComposerForEdit(id)}
                  onGenerateMnemonic={(id) => void runCardAction(id, "mnemonic")}
                  onRegenerateCard={(id) => void runCardAction(id, "regenerate")}
                  onUndoRewrite={() => void undoRegenerate()}
                  onDismissRewriteNotice={() => showRegenNotice(null)}
                  onOpenAssistant={() => focusComposerForEdit(null)}
                />
              )}
            </section>
          </div>
        </>
      )}

      <CardEditOverlay
        open={overlayOpen && Boolean(focused)}
        card={focused ? draftToOverlayCard(focused) : null}
        cardIndex={focused ? cards.findIndex((c) => c.id === focused.id) : -1}
        busy={generating || cardsLoading}
        onClose={() => setOverlayOpen(false)}
        onSaved={handleCardSaved}
        onDelete={focused ? () => requestCardDelete([focused.id]) : undefined}
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
        backLabel="Cancel"
        onClose={() => setDeckImportOpen(false)}
      />

    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    height: "100%",
    boxSizing: "border-box",
  },
  panelHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
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
    color: "var(--fg-quaternary)",
    flexShrink: 0,
  },
  emptyAction: {
    marginTop: 12,
    flexShrink: 0,
  },
  emptyText: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-quaternary)",
    maxWidth: 300,
    minHeight: 40,
  },
};

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
    <div ref={rootRef} className="dhc-menu-root dhc-menu-root--shrink">
      <button
        type="button"
        className="create-topbar-control create-deck-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <i
          className="ri-folder-3-line create-topbar-control__icon"
          aria-hidden
        />
        <span className="create-topbar-control__label create-topbar-control__label--strong">{label}</span>
        <i
          className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} create-topbar-control__caret`}
          aria-hidden
        />
      </button>

      {open ? (
        <DeckMenu
          decks={decks}
          currentId={currentId}
          placement="down"
          align="left"
          onNew={() => {
            setOpen(false);
            onSelect(NEW_DECK_VALUE);
          }}
          onSelect={(deckId) => {
            setOpen(false);
            onSelect(deckId);
          }}
        />
      ) : null}
    </div>
  );
}
