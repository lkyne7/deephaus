"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SOURCE_FILE_BYTES,
  MAX_VIDEO_BYTES,
  parseGenerationSettings,
  type CardMix,
  type DetailLevel,
  type DraftCard,
  type ImageOcclusionData,
  CARD_MIX_OPTIONS,
  DETAIL_LEVEL_OPTIONS,
  detailLevelLabel,
  cardTypeLabel,
} from "@deephaus/shared";
import { CardEditorPanel, type EditableCard } from "@/components/card-editor-panel";
import { CardListSkeleton } from "@/components/ui/skeleton-patterns";
import { StudyCardTags } from "@/components/study-card-tags";
import { cardAnswerText, cardPreviewText, type BrowseCardRow } from "@/lib/browse/cards";
import { buildCardUpdateBody } from "@/lib/cards/update";
import { buildSourceChunks, toChunkPreviews, type SourceChunkPreview } from "@/lib/sources/chunks";
import {
  DOCUMENT_ACCEPT,
  VIDEO_ACCEPT,
  detectSourceFileKind,
} from "@/lib/sources/file-types";
import { parseYouTubeVideoId } from "@/lib/youtube/parse";
import { taskPhaseLabel, useBackgroundTasks } from "@/lib/background-tasks/context";
import "@/components/rich-text/rich-text.css";

type SourceMode = "text" | "document" | "video";
type VideoInputMode = "upload" | "youtube";
type ScopeMode = "all" | "segments";
type DeckOption = { id: string; name: string };

const NEW_DECK_VALUE = "__new__";
const MAX_FILE_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);
const MAX_VIDEO_MB = MAX_VIDEO_BYTES / (1024 * 1024);

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
    tags: row.tags,
    sort_order: row.sort_order,
    user_edited: row.user_edited,
    created_at: "",
    updated_at: "",
  };
}

type Props = {
  initialDeckId?: string | null;
};

export function CreateDeckView({ initialDeckId = null }: Props) {
  const router = useRouter();
  const { tasks, getTaskForProject, startDeckGeneration } = useBackgroundTasks();
  const [deckName, setDeckName] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [debouncedYoutubeUrl, setDebouncedYoutubeUrl] = useState("");
  const [previewRawText, setPreviewRawText] = useState<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [chunks, setChunks] = useState<SourceChunkPreview[]>([]);
  const [selectedChunks, setSelectedChunks] = useState<Set<number>>(() => new Set());
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [cardMix, setCardMix] = useState<CardMix>("basic");
  const [focusPrompt, setFocusPrompt] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [existingDecks, setExistingDecks] = useState<DeckOption[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [decksLoading, setDecksLoading] = useState(true);
  const [cards, setCards] = useState<DraftCard[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const lastSyncedTaskRef = useRef<string | null>(null);

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

  const detailSliderIndex = useMemo(() => {
    const idx = DETAIL_LEVEL_OPTIONS.findIndex((o) => o.value === detailLevel);
    return idx >= 0 ? idx : 1;
  }, [detailLevel]);

  const focused = useMemo(
    () => cards.find((c) => c.id === focusedId) ?? null,
    [cards, focusedId],
  );

  const applyChunks = useCallback((next: SourceChunkPreview[]) => {
    setChunks(next);
    setSelectedChunks(new Set(next.map((c) => c.index)));
  }, []);

  const loadDeckCards = useCallback(async (deckId: string) => {
    setCardsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ deck_id: deckId, limit: "200", offset: "0" });
      const res = await fetch(`/api/browse/cards?${params}`, { credentials: "include" });
      const data = await readJson<{ cards: BrowseCardRow[]; total: number }>(res);
      setCards(data.cards.map(browseRowToDraft));
      setTotalCards(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deck cards");
      setCards([]);
      setTotalCards(0);
    } finally {
      setCardsLoading(false);
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
        setCardMix(parsed.cardMix);
        setFocusPrompt(parsed.focusPrompt ?? "");
      } catch {
        // Keep deck name from list if project fetch fails.
      }

      await loadDeckCards(deckId);
    },
    [loadDeckCards],
  );

  const startNewDeck = useCallback(() => {
    setProjectId(null);
    setDeckName("");
    setCards([]);
    setTotalCards(0);
    setFocusedId(null);
    setDetailLevel("medium");
    setCardMix("basic");
    setFocusPrompt("");
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
        if (!cancelled) setDecksLoading(false);
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
    if (cards.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !cards.some((c) => c.id === focusedId)) {
      setFocusedId(cards[0].id);
    }
  }, [cards, focusedId]);

  const chunkIndices = useMemo(() => {
    if (scopeMode === "all") return undefined;
    return [...selectedChunks].sort((a, b) => a - b);
  }, [scopeMode, selectedChunks]);

  const settings = useMemo(
    () => ({
      cardMix,
      detailLevel,
      focusPrompt: focusPrompt.trim() || undefined,
    }),
    [cardMix, detailLevel, focusPrompt],
  );

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
  }, [loadDeckCards, projectId, tasks]);

  async function generate() {
    setError(null);

    try {
      const isNewDeck = !projectId;
      if (isNewDeck && !(deckName ?? "").trim()) throw new Error("Give your deck a name.");
      if (sourceMode === "text" && text.trim().length < 20) {
        throw new Error("Paste at least 20 characters of text.");
      }
      if (sourceMode === "document" || (sourceMode === "video" && videoInputMode === "upload")) {
        if (!file) {
          throw new Error(
            sourceMode === "video" ? "Choose a video to upload." : "Choose a file to upload.",
          );
        }
      } else if (sourceMode === "video" && videoInputMode === "youtube") {
        if (!parseYouTubeVideoId(youtubeUrl)) {
          throw new Error("Enter a valid YouTube link.");
        }
        if (!previewRawText) {
          throw new Error("Wait for YouTube captions to load before generating.");
        }
      }
      if (file) {
        const kind = detectSourceFileKind(file.name, file.type);
        if (sourceMode === "document" && kind !== "document") {
          throw new Error("Choose a PDF, Word (.docx), or PowerPoint (.pptx) file.");
        }
        if (sourceMode === "video" && kind !== "video") {
          throw new Error("Choose a supported video file (MP4, WebM, MOV, etc.).");
        }
        const maxBytes = sourceMode === "video" ? MAX_VIDEO_BYTES : MAX_SOURCE_FILE_BYTES;
        const maxMb = sourceMode === "video" ? MAX_VIDEO_MB : MAX_FILE_MB;
        if (file.size > maxBytes) {
          throw new Error(`File must be under ${maxMb} MB.`);
        }
      }
      if (scopeMode === "segments" && (!chunkIndices || chunkIndices.length === 0)) {
        throw new Error("Select at least one segment to generate from.");
      }
      if (chunks.length === 0) {
        throw new Error("Add source content with enough text to generate segments.");
      }

      const taskId = startDeckGeneration({
        projectId,
        deckName: deckName ?? "",
        settings,
        chunkIndices,
        sourceMode,
        videoInputMode,
        text,
        youtubeUrl,
        previewRawText,
        file,
        onProjectCreated: (nextProjectId, nextDeckName) => {
          setProjectId(nextProjectId);
          setExistingDecks((prev) => [
            { id: nextProjectId, name: nextDeckName },
            ...prev.filter((deck) => deck.id !== nextProjectId),
          ]);
          router.replace(`/decks/new?deck=${nextProjectId}`);
        },
      });
      setActiveTaskId(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function saveCard(updated: EditableCard, tags: string[]) {
    setSaving(true);
    setError(null);
    try {
      const body = buildCardUpdateBody({
        type: updated.type,
        front: updated.front,
        back: updated.back,
        cloze_text: updated.cloze_text,
        extra: updated.extra,
        occlusion_data: (updated.occlusion_data as ImageOcclusionData | undefined) ?? null,
        tags,
      });
      const res = await fetch(`/api/cards/${updated.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = (await res.json()) as DraftCard;
      setCards((prev) => prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCard() {
    if (!focused) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${focused.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setCards((prev) => prev.filter((c) => c.id !== focused.id));
      setTotalCards((prev) => Math.max(0, prev - 1));
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

  const generateLabel = useMemo(() => {
    if (generating) return "Generating in background…";
    if (projectId && totalCards > 0) return "Add more cards";
    return "Generate cards";
  }, [generating, projectId, totalCards]);

  const listSummary = useMemo(() => {
    if (cardsLoading) return "Loading cards…";
    if (totalCards === 0 && cards.length === 0) {
      return "Generated cards will appear here for review and editing.";
    }
    if (totalCards > cards.length) {
      return `Displaying ${cards.length} of ${totalCards} cards`;
    }
    return `${totalCards} card${totalCards === 1 ? "" : "s"}`;
  }, [cards.length, cardsLoading, totalCards]);

  return (
    <div style={s.shell}>
      <aside style={s.sourcePane}>
        <div style={s.sourceScroll}>
          <div style={s.deckSection}>
            <h2 style={s.sectionTitle}>Deck</h2>
            <div className="field">
              <label className="field-label" htmlFor="target-deck">
                Target deck
              </label>
              <select
                id="target-deck"
                value={projectId ?? NEW_DECK_VALUE}
                onChange={(e) => void handleDeckChange(e.target.value)}
                className="input"
                style={s.deckSelectFull}
                disabled={decksLoading || generating}
                aria-label="Target deck"
              >
                <option value={NEW_DECK_VALUE}>Create new deck…</option>
                {existingDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>
            {!projectId ? (
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label" htmlFor="deck-name">
                  Deck name
                </label>
                <input
                  id="deck-name"
                  className="input"
                  value={deckName ?? ""}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="e.g. Biology midterm"
                  disabled={decksLoading || generating}
                  aria-label="New deck name"
                />
              </div>
            ) : null}
            <div style={s.deckLinks}>
              <Link href="/decks/import" className="btn btn-ghost btn-sm">
                <i className="ri-folder-download-line" />
                Import .apkg
              </Link>
              {projectId ? (
                <Link href={`/decks/${projectId}`} className="btn btn-ghost btn-sm">
                  <i className="ri-external-link-line" />
                  Open deck
                </Link>
              ) : null}
            </div>
          </div>

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
            </div>

            {sourceMode === "text" ? (
              <div className="field" style={{ marginTop: 16 }}>
                <label className="field-label" htmlFor="source-text">
                  Paste notes, transcripts, or any text
                </label>
                <textarea
                  id="source-text"
                  className="textarea"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your source material here…"
                  style={{ minHeight: 200 }}
                />
                <span style={s.hint}>{text.length.toLocaleString()} characters</span>
              </div>
            ) : sourceMode === "document" ? (
              <div key="document-upload" className="field" style={{ marginTop: 16 }}>
                <span className="field-label">PDF, Word, or PowerPoint</span>
                <input
                  ref={documentInputRef}
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  style={s.dropzoneBtn}
                  onClick={() => documentInputRef.current?.click()}
                >
                  <i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: "var(--ink-400)" }} />
                  <span style={s.dropzoneTitle}>
                    {file ? file.name : "Click to choose a file"}
                  </span>
                  <span style={s.hint}>PDF, .docx, .pptx · up to {MAX_FILE_MB} MB</span>
                </button>
                {previewBusy && (
                  <span style={s.hint}>
                    <i className="ri-loader-4-line icon-spin" /> Extracting text…
                  </span>
                )}
              </div>
            ) : (
              <div key="video-source" className="field" style={{ marginTop: 16 }}>
                <div style={{ ...tab.wrap, marginBottom: 12 }}>
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
                  >
                    <i className="ri-youtube-line" />
                    YouTube link
                  </button>
                </div>

                {videoInputMode === "upload" ? (
                  <>
                    <span className="field-label">Video file</span>
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept={VIDEO_ACCEPT}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      style={s.dropzoneBtn}
                      onClick={() => videoInputRef.current?.click()}
                    >
                      <i className="ri-film-line" style={{ fontSize: 28, color: "var(--ink-400)" }} />
                      <span style={s.dropzoneTitle}>
                        {file ? file.name : "Click to choose a video"}
                      </span>
                      <span style={s.hint}>MP4, WebM, MOV · up to {MAX_VIDEO_MB} MB</span>
                    </button>
                    {previewBusy && (
                      <span style={s.hint}>
                        <i className="ri-loader-4-line icon-spin" /> Transcribing video…
                      </span>
                    )}
                    <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                      Speech is transcribed with Whisper, then turned into flashcards.
                    </span>
                  </>
                ) : (
                  <>
                    <label className="field-label" htmlFor="youtube-url">
                      YouTube URL
                    </label>
                    <input
                      id="youtube-url"
                      className="input"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=…"
                    />
                    {previewBusy && (
                      <span style={s.hint}>
                        <i className="ri-loader-4-line icon-spin" /> Fetching captions…
                      </span>
                    )}
                    {!previewBusy && parseYouTubeVideoId(youtubeUrl) && chunks.length > 0 ? (
                      <span style={s.hint}>Captions loaded · {chunks.length} segments</span>
                    ) : null}
                    <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                      Uses the video&apos;s captions (manual or auto-generated). Videos without subtitles cannot be used.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {chunks.length > 0 && (
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
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={s.segmentRef}>{chunk.sourceRef}</div>
                            <div style={s.segmentPreview}>{chunk.preview}</div>
                            <div style={s.segmentMeta}>{chunk.charCount.toLocaleString()} chars</div>
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

          <div style={s.settingsSection}>
            <h2 style={{ ...s.sectionTitle, margin: 0 }}>Card settings</h2>

            <div style={s.settingsField}>
              <label className="field-label" htmlFor="detail-level">
                Level of detail — {detailLevelLabel(detailLevel)}
              </label>
              <input
                id="detail-level"
                type="range"
                min={0}
                max={2}
                step={1}
                value={detailSliderIndex}
                onChange={(e) => {
                  const next = DETAIL_LEVEL_OPTIONS[Number(e.target.value)]?.value ?? "medium";
                  setDetailLevel(next);
                }}
                style={{ accentColor: "var(--teal-500)", width: "100%" }}
              />
              <div style={s.sliderLabels}>
                {DETAIL_LEVEL_OPTIONS.map((option) => (
                  <span key={option.value}>{option.label}</span>
                ))}
              </div>
            </div>

            <div style={s.settingsField}>
              <span className="field-label">Card type</span>
              <div style={{ ...tab.wrap, width: "100%" }}>
                {CARD_MIX_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCardMix(option.value)}
                    style={{
                      ...tab.btn,
                      flex: 1,
                      justifyContent: "center",
                      minWidth: 0,
                      ...(cardMix === option.value ? tab.btnActive : {}),
                    }}
                  >
                    <i
                      className={
                        option.value === "basic" ? "ri-question-answer-line" : "ri-input-method-line"
                      }
                    />
                    {cardTypeLabel(option.value, "short")}
                  </button>
                ))}
              </div>
            </div>

            <div style={s.settingsField}>
              <label className="field-label" htmlFor="focus">
                Focus prompt (optional)
              </label>
              <input
                id="focus"
                className="input"
                value={focusPrompt}
                onChange={(e) => setFocusPrompt(e.target.value)}
                placeholder="e.g. exam prep, definitions only"
              />
            </div>
          </div>
        </div>

        <div style={s.sourceFooter}>
          {error && <div className="notice notice-error">{error}</div>}
          {activeTask && (
            <div style={s.status}>
              {generating ? <i className="ri-loader-4-line icon-spin" /> : null}
              <span>{taskPhaseLabel(activeTask)}</span>
              {generating ? (
                <span style={s.statusHint}>You can navigate away while this runs.</span>
              ) : null}
            </div>
          )}
          <div style={s.sourceActions}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={generating || previewBusy}
              onClick={() => void generate()}
            >
              {generateLabel}
            </button>
          </div>
        </div>
      </aside>

      <section style={s.cardsPane}>
        <div style={s.cardsTopBar}>
          <p style={s.listSummary}>{listSummary}</p>
          {projectId && totalCards > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => router.push(`/decks/${projectId}`)}
            >
              Open deck
            </button>
          ) : null}
        </div>

        <div style={s.cardsSplit}>
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
              <div style={s.listScroll}>
                {cards.map((card, index) => {
                  const active = card.id === focusedId;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setFocusedId(card.id)}
                      style={{
                        ...s.cardRow,
                        ...(active ? s.cardRowActive : {}),
                      }}
                    >
                      <div style={s.cardRowTop}>
                        <span style={s.cardIndex}>#{index + 1}</span>
                        <span className={`chip ${card.type === "cloze" ? "chip-due" : "chip-new"}`}>
                          {cardTypeLabel(card.type, "short")}
                        </span>
                      </div>
                      <div style={s.cardPreview}>{truncate(cardPreviewText(card))}</div>
                      <div style={s.cardAnswer}>{truncate(cardAnswerText(card))}</div>
                      {card.tags.length > 0 ? (
                        <StudyCardTags tags={card.tags} align="start" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <CardEditorPanel
            key={focused?.id ?? "no-card"}
            card={focused}
            deckName={(deckName ?? "").trim() || "New deck"}
            emptyMessage="Generate cards or select one to edit"
            saving={saving}
            busy={generating || cardsLoading}
            onSave={saveCard}
            onDelete={cards.length > 0 ? deleteCard : undefined}
          />
        </div>
      </section>
    </div>
  );
}

const tab = {
  wrap: {
    display: "inline-flex",
    padding: 4,
    background: "var(--ink-25)",
    borderRadius: 9999,
    gap: 4,
    flexWrap: "wrap" as const,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "transparent",
    color: "var(--ink-500)",
    border: 0,
    borderRadius: 9999,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
  } as React.CSSProperties,
  btnActive: {
    background: "var(--white)",
    color: "var(--ink-900)",
    boxShadow: "var(--shadow-xs)",
  } as React.CSSProperties,
};

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)",
    gap: 16,
    height: "calc(100vh - var(--app-chrome-height))",
    padding: "16px 24px 20px",
    boxSizing: "border-box",
  },
  sourcePane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
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
  sourceFooter: {
    borderTop: "1px solid var(--border-1)",
    padding: "14px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
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
  settingsSection: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  settingsField: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sliderLabels: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
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
  status: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-3)",
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
    borderRadius: 12,
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
    borderRadius: 12,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
  },
  dropzoneTitle: {
    color: "var(--ink-700)",
    font: "500 14px/20px var(--font-sans)",
  },
  segmentBox: {
    marginTop: 12,
    border: "1px solid var(--border-2)",
    borderRadius: 12,
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
    maxHeight: 220,
    overflow: "auto",
  },
  segmentRow: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-1)",
    cursor: "pointer",
    background: "var(--white)",
  },
  segmentRowActive: {
    background: "var(--brand-25)",
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
  listSummary: {
    margin: 0,
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
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
    minHeight: 0,
    height: "100%",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  listScroll: {
    flex: 1,
    overflow: "auto",
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
    boxShadow: "inset 3px 0 0 var(--teal-500)",
  },
  cardRowTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  cardIndex: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  cardPreview: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  cardAnswer: {
    marginTop: 4,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
