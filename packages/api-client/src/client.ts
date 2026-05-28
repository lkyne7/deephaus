import type {
  AnkiImportResponse,
  BrowseCardsResponse,
  CardUpdateBody,
  CommunityDeckDetail,
  CommunityDeckRow,
  DashboardStats,
  DeckOverview,
  DeckStats,
  ExplainCardResponse,
  FsrsOptimizeResponse,
  GenerateTextResponse,
  ReviewHeatmapData,
  ReviewRestoreBody,
  ReviewRestoreResponse,
  StartGenerationResponse,
  StudyDecksResponse,
  StudyQueueResponse,
  SubmitReviewBody,
  SubmitReviewResponse,
  SubscribeDeckResponse,
  UpdateDeckBody,
  BrowseCardRow,
} from "./types.js";
import type { DraftCard, GenerationJob, GenerationSettings, Project, Source } from "@deephaus/shared";
import { apiRequest, apiRequestBlob, type RequestContext } from "./request.js";
import type { DeepHausClientOptions } from "./options.js";

function ctx(options: DeepHausClientOptions): RequestContext {
  return { options };
}

export function createDeepHausClient(options: DeepHausClientOptions) {
  const c = ctx(options);

  return {
    listDecks: () => apiRequest<StudyDecksResponse>(c, "/api/study/decks"),
    listStudyDecks: () => apiRequest<StudyDecksResponse>(c, "/api/study/decks"),
    getDeckOverview: (deckId: string) => apiRequest<DeckOverview>(c, `/api/decks/${deckId}/overview`),
    getDeckStats: (deckId: string) => apiRequest<DeckStats>(c, `/api/decks/${deckId}/stats`),
    getDeck: (deckId: string) => apiRequest<Project>(c, `/api/projects/${deckId}`),
    updateDeck: (deckId: string, body: UpdateDeckBody) =>
      apiRequest<Project>(c, `/api/projects/${deckId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    listProjects: () => apiRequest<Project[]>(c, "/api/projects"),
    createProject: (body: { name: string; deck_name: string; settings?: GenerationSettings }) =>
      apiRequest<Project>(c, "/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getProject: (id: string) => apiRequest<Project>(c, `/api/projects/${id}`),
    listCards: (jobId: string) =>
      apiRequest<DraftCard[]>(c, `/api/cards?job_id=${encodeURIComponent(jobId)}`),
    getCard: (id: string) => apiRequest<BrowseCardRow>(c, `/api/cards/${id}`),
    updateCard: (id: string, body: CardUpdateBody) =>
      apiRequest<DraftCard>(c, `/api/cards/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    deleteCard: (id: string) => apiRequest<void>(c, `/api/cards/${id}`, { method: "DELETE" }),
    suspendCard: (id: string, suspended: boolean) =>
      apiRequest<{ ok: boolean }>(c, `/api/cards/${id}/suspend`, {
        method: "PATCH",
        body: JSON.stringify({ suspended }),
      }),
    explainCard: (id: string) =>
      apiRequest<ExplainCardResponse>(c, `/api/cards/${id}/explain`, { method: "POST" }),
    getStudyQueue: (deckId: string, params?: { limit?: number; newLimit?: number }) => {
      const search = new URLSearchParams();
      if (params?.limit != null) search.set("limit", String(params.limit));
      if (params?.newLimit != null) search.set("newLimit", String(params.newLimit));
      const qs = search.toString();
      return apiRequest<StudyQueueResponse>(c, `/api/decks/${deckId}/review${qs ? `?${qs}` : ""}`);
    },
    submitReview: (cardId: string, body: SubmitReviewBody) =>
      apiRequest<SubmitReviewResponse>(c, `/api/cards/${cardId}/review`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    restoreReview: (cardId: string, body: ReviewRestoreBody = {}) =>
      apiRequest<ReviewRestoreResponse>(c, `/api/cards/${cardId}/review/restore`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    generateFromText: (projectId: string, text: string, settings?: Partial<GenerationSettings>) =>
      apiRequest<GenerateTextResponse>(c, "/api/generate/text", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, text, settings }),
      }),
    addTextSource: (projectId: string, text: string) =>
      apiRequest<Source>(c, "/api/sources/text", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, text }),
      }),
    uploadPdfSource: (projectId: string, file: Blob | File, filename = "upload.pdf") => {
      const form = new FormData();
      form.append("project_id", projectId);
      form.append("file", file, filename);
      return apiRequest<Source>(c, "/api/sources/pdf", { method: "POST", body: form });
    },
    uploadFileSource: (projectId: string, file: Blob | File, filename: string) => {
      const form = new FormData();
      form.append("project_id", projectId);
      form.append("file", file, filename);
      return apiRequest<Source>(c, "/api/sources/file", { method: "POST", body: form });
    },
    addYoutubeSource: (projectId: string, url: string) =>
      apiRequest<Source>(c, "/api/sources/youtube", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, url }),
      }),
    startGeneration: (sourceId: string, settings?: Partial<GenerationSettings>) =>
      apiRequest<StartGenerationResponse>(c, "/api/generate", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, settings }),
      }),
    getJob: (jobId: string) => apiRequest<GenerationJob>(c, `/api/jobs/${jobId}`),
    importAnki: (
      file: Blob | File,
      filename = "deck.apkg",
      opts: { deckName?: string; scheduling?: boolean } = {},
    ) => {
      const form = new FormData();
      form.append("file", file, filename);
      if (opts.deckName?.trim()) form.append("deck_name", opts.deckName.trim());
      if (opts.scheduling === false) form.append("scheduling", "false");
      return apiRequest<AnkiImportResponse>(c, "/api/import/anki", { method: "POST", body: form });
    },
    exportDeck: (projectId: string, jobId: string) =>
      apiRequestBlob(c, "/api/export", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, job_id: jobId }),
      }),
    browseCards: (params?: {
      deck_id?: string;
      tag?: string;
      q?: string;
      limit?: number;
      offset?: number;
      filters?: boolean;
    }) => {
      const search = new URLSearchParams();
      if (params?.deck_id) search.set("deck_id", params.deck_id);
      if (params?.tag) search.set("tag", params.tag);
      if (params?.q) search.set("q", params.q);
      if (params?.limit != null) search.set("limit", String(params.limit));
      if (params?.offset != null) search.set("offset", String(params.offset));
      if (params?.filters) search.set("filters", "1");
      const qs = search.toString();
      return apiRequest<BrowseCardsResponse>(c, `/api/browse/cards${qs ? `?${qs}` : ""}`);
    },
    browseBatch: (body: { action: "suspend" | "unsuspend" | "delete"; card_ids: string[] }) =>
      apiRequest<{ ok: boolean }>(c, "/api/browse/batch", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    uploadCardMedia: (cardId: string, file: Blob | File, filename: string) => {
      const form = new FormData();
      form.append("file", file, filename);
      return apiRequest<{ url: string }>(c, `/api/cards/${cardId}/media`, {
        method: "POST",
        body: form,
      });
    },
    listCommunityDecks: async (q?: string) => {
      const search = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const decks = await apiRequest<CommunityDeckRow[]>(c, `/api/community/decks${search}`);
      return { decks: Array.isArray(decks) ? decks : [] };
    },
    getCommunityDeck: (publicationId: string) =>
      apiRequest<CommunityDeckDetail>(c, `/api/community/decks/${publicationId}`),
    subscribeCommunityDeck: (publicationId: string, syncMode: "follow" | "fork" = "fork") =>
      apiRequest<SubscribeDeckResponse>(c, `/api/community/decks/${publicationId}/subscribe`, {
        method: "POST",
        body: JSON.stringify({ sync_mode: syncMode }),
      }),
    unsubscribeCommunityDeck: (publicationId: string) =>
      apiRequest<{ ok: boolean }>(c, `/api/community/decks/${publicationId}/subscribe`, {
        method: "DELETE",
      }),
    getPublication: (projectId: string) =>
      apiRequest<CommunityDeckRow | null>(
        c,
        `/api/community/publish?project_id=${encodeURIComponent(projectId)}`,
      ),
    publishDeck: (body: { project_id: string; title?: string; description?: string | null }) =>
      apiRequest<CommunityDeckRow>(c, "/api/community/publish", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    unpublishDeck: (projectId: string) =>
      apiRequest<{ ok: boolean }>(
        c,
        `/api/community/publish?project_id=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      ),
    getDashboardStats: () => apiRequest<DashboardStats>(c, "/api/stats/dashboard"),
    getReviewHeatmap: (year?: number) => {
      const qs = year != null ? `?year=${year}` : "";
      return apiRequest<ReviewHeatmapData>(c, `/api/stats/heatmap${qs}`);
    },
    optimizeFsrs: () => apiRequest<FsrsOptimizeResponse>(c, "/api/fsrs/optimize", { method: "POST" }),
  };
}

export type DeepHausClient = ReturnType<typeof createDeepHausClient>;
