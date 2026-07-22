import type {
  AdvancedStats,
  AnkiImportResponse,
  BillingStatus,
  BrowseCardsResponse,
  CardUpdateBody,
  CreateCardBody,
  CommunityDeckDetail,
  CommunityDeckRatingResponse,
  CommunityDeckRow,
  CramPlanAction,
  CramPlanDetail,
  CramPlanListItem,
  CramPlanStatus,
  CramQueueResponse,
  CramReviewResponse,
  CramSelectorOptions,
  CreateCramPlanBody,
  UpdateCramPlanBody,
  GlobalSearchResponse,
  LeaderboardData,
  LeaderboardPeriod,
  TopicSuggestionsResponse,
  DashboardStats,
  DeckOverview,
  DeckStats,
  AutoDetectOcclusionResponse,
  ExplainCardResponse,
  FsrsOptimizeResponse,
  FsrsSettingsResponse,
  UpdateFsrsSettingsBody,
  GenerateTextResponse,
  ReviewHeatmapData,
  ReviewRestoreBody,
  ReviewRestoreResponse,
  QuizletImportResponse,
  StartGenerationResponse,
  StudyDecksResponse,
  StudyQueueResponse,
  SubmitReviewBody,
  SubmitReviewResponse,
  SubscribeDeckResponse,
  UpdateDeckBody,
  UpdateProfileBody,
  UniversitySearchResponse,
  UniversityVerificationResponse,
  UniversityVerificationSendResponse,
  UserProfile,
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
    createCard: (body: CreateCardBody) =>
      apiRequest<DraftCard>(c, "/api/cards", {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
    autoDetectOcclusion: (id: string) =>
      apiRequest<AutoDetectOcclusionResponse>(c, `/api/cards/${id}/occlusion/auto-detect`, {
        method: "POST",
      }),
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
    uploadAndGenerateFileSource: (
      projectId: string,
      file: Blob | File,
      filename: string,
      settings?: Partial<GenerationSettings>,
    ) => {
      const form = new FormData();
      form.append("project_id", projectId);
      form.append("file", file, filename);
      form.append("generate", "true");
      if (settings) form.append("settings", JSON.stringify(settings));
      return apiRequest<Source & StartGenerationResponse>(c, "/api/sources/file", {
        method: "POST",
        body: form,
      });
    },
    uploadAndGeneratePdfSource: (
      projectId: string,
      file: Blob | File,
      filename = "upload.pdf",
      settings?: Partial<GenerationSettings>,
    ) => {
      const form = new FormData();
      form.append("project_id", projectId);
      form.append("file", file, filename);
      form.append("generate", "true");
      if (settings) form.append("settings", JSON.stringify(settings));
      return apiRequest<Source & StartGenerationResponse>(c, "/api/sources/pdf", {
        method: "POST",
        body: form,
      });
    },
    addYoutubeSource: (projectId: string, url: string, settings?: Partial<GenerationSettings>) =>
      apiRequest<Source & StartGenerationResponse>(c, "/api/sources/youtube", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, url, generate: true, settings }),
      }),
    addWebsiteSource: (projectId: string, url: string, settings?: Partial<GenerationSettings>) =>
      apiRequest<Source & StartGenerationResponse>(c, "/api/sources/website", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, url, generate: true, settings }),
      }),
    generateFromTopic: (projectId: string, topic: string, settings?: Partial<GenerationSettings>) =>
      apiRequest<GenerateTextResponse>(c, "/api/generate/topic", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, topic, settings }),
      }),
    getTopicSuggestions: () =>
      apiRequest<TopicSuggestionsResponse>(c, "/api/generate/topic/suggestions"),
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
    importQuizlet: (content: string, deckName?: string) =>
      apiRequest<QuizletImportResponse>(c, "/api/import/quizlet", {
        method: "POST",
        body: JSON.stringify({
          content,
          deck_name: deckName?.trim() || undefined,
        }),
      }),
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
    rateCommunityDeck: (publicationId: string, stars: number) =>
      apiRequest<CommunityDeckRatingResponse>(c, `/api/community/decks/${publicationId}/rating`, {
        method: "PUT",
        body: JSON.stringify({ stars }),
      }),
    clearCommunityDeckRating: (publicationId: string) =>
      apiRequest<CommunityDeckRatingResponse>(c, `/api/community/decks/${publicationId}/rating`, {
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
    getProfile: () => apiRequest<UserProfile>(c, "/api/profile"),
    updateProfile: (body: UpdateProfileBody) =>
      apiRequest<UserProfile>(c, "/api/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    searchUniversities: (query: string, limit = 12) =>
      apiRequest<UniversitySearchResponse>(
        c,
        `/api/profile/universities?q=${encodeURIComponent(query)}&limit=${limit}`,
      ),
    sendUniversityVerification: (email: string, universityId?: string | null) =>
      apiRequest<UniversityVerificationSendResponse>(
        c,
        "/api/profile/university-email/send",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            university_id: universityId || undefined,
          }),
        },
      ),
    verifyUniversityEmail: (email: string, code: string) =>
      apiRequest<UniversityVerificationResponse>(
        c,
        "/api/profile/university-email/verify",
        {
          method: "POST",
          body: JSON.stringify({ email, code }),
        },
      ),
    getAdvancedStats: (deckId?: string | null) => {
      const deck = deckId ?? "all";
      return apiRequest<AdvancedStats>(c, `/api/stats/advanced?deck=${encodeURIComponent(deck)}`);
    },
    optimizeFsrs: () => apiRequest<FsrsOptimizeResponse>(c, "/api/fsrs/optimize", { method: "POST" }),
    getFsrsSettings: () => apiRequest<FsrsSettingsResponse>(c, "/api/fsrs/settings"),
    updateFsrsSettings: (body: UpdateFsrsSettingsBody) =>
      apiRequest<FsrsSettingsResponse>(c, "/api/fsrs/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    getBillingStatus: () => apiRequest<BillingStatus>(c, "/api/billing/status"),
    getLeaderboard: (period: LeaderboardPeriod = "week") =>
      apiRequest<LeaderboardData>(c, `/api/stats/leaderboard?period=${period}`),
    globalSearch: (query: string, limit?: number) => {
      const search = new URLSearchParams({ q: query });
      if (limit != null) search.set("limit", String(limit));
      return apiRequest<GlobalSearchResponse>(c, `/api/search?${search.toString()}`);
    },
    listCramPlans: (status?: CramPlanStatus) => {
      const qs = status ? `?status=${status}` : "";
      return apiRequest<{ plans: CramPlanListItem[] }>(c, `/api/cram-plans${qs}`);
    },
    createCramPlan: (body: CreateCramPlanBody) =>
      apiRequest<CramPlanDetail>(c, "/api/cram-plans", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getCramPlanOptions: () => apiRequest<CramSelectorOptions>(c, "/api/cram-plans/options"),
    getCramPlan: (planId: string) =>
      apiRequest<CramPlanDetail>(c, `/api/cram-plans/${planId}`),
    updateCramPlan: (planId: string, body: UpdateCramPlanBody) =>
      apiRequest<CramPlanDetail>(c, `/api/cram-plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    transitionCramPlan: (planId: string, action: CramPlanAction) =>
      apiRequest<CramPlanDetail>(c, `/api/cram-plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
    deleteCramPlan: (planId: string) =>
      apiRequest<{ ok: boolean }>(c, `/api/cram-plans/${planId}`, { method: "DELETE" }),
    getCramQueue: (planId: string, params?: { limit?: number; continuePastBudget?: boolean }) => {
      const search = new URLSearchParams();
      if (params?.limit != null) search.set("limit", String(params.limit));
      if (params?.continuePastBudget) search.set("continue", "1");
      const qs = search.toString();
      return apiRequest<CramQueueResponse>(
        c,
        `/api/cram-plans/${planId}/queue${qs ? `?${qs}` : ""}`,
      );
    },
    submitCramReview: (
      planId: string,
      body: { item_id: string; rating: 1 | 2 | 3 | 4; response_ms: number },
    ) =>
      apiRequest<CramReviewResponse>(c, `/api/cram-plans/${planId}/review`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  };
}

export type DeepHausClient = ReturnType<typeof createDeepHausClient>;
