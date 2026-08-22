/**
 * Offline-first data facade. When a PowerSync instance is configured
 * (EXPO_PUBLIC_POWERSYNC_URL), core study/cram/dashboard reads and review
 * writes run against the local SQLite replica and sync in the background.
 * Without it, calls fall through to the online API client.
 */
import type {
  BrowseCardRow,
  BrowseCardsResponse,
  CardUpdateBody,
  CramQueueResponse,
  CramReviewResponse,
  CreateCardBody,
  DashboardStats,
  ReviewHeatmapData,
  ReviewRestoreBody,
  ReviewRestoreResponse,
  StudyDecksResponse,
  StudyQueueResponse,
  SubmitReviewBody,
  SubmitReviewResponse,
} from "@deephaus/api-client";
import type { DraftCard, Project } from "@deephaus/shared";
import {
  batchLocalCardAction,
  browseLocalCards,
  createLocalCard,
  deleteLocalCard,
  getLocalBrowseCard,
  getLocalCramQueuePayload,
  getLocalDashboardStats,
  getLocalReviewHeatmap,
  getLocalStudyDeckOptions,
  getLocalStudyQueuePayload,
  listLocalProjects,
  restoreLocalReviewState,
  submitLocalCramReview,
  submitLocalReview,
  suspendLocalCard,
  updateLocalCard,
} from "@deephaus/local-db";
import type { CardReviewRow, FsrsGrade } from "@deephaus/scheduling";
import { getNetworkStateAsync } from "expo-network";
import { api } from "./api";
import { loadStoredSession } from "./auth-session";
import {
  getPowerSync,
  hasPendingPowerSyncWrites,
  offlineEnabled,
} from "./powersync";

function isApiError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

async function shouldReadLocally(): Promise<boolean> {
  if (!offlineEnabled) return false;
  if (await hasPendingPowerSyncWrites()) return true;
  try {
    const state = await getNetworkStateAsync();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

async function readWithOfflineFallback<T>(
  remote: () => Promise<T>,
  local: () => Promise<T>,
): Promise<T> {
  if (await shouldReadLocally()) return local();
  try {
    return await remote();
  } catch (error) {
    // HTTP errors are authoritative. Only transport failures fall back to the
    // replica, which may still contain a usable offline snapshot.
    if (!offlineEnabled || isApiError(error)) throw error;
    return local();
  }
}

async function requireUserId(): Promise<string> {
  const session = await loadStoredSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  return userId;
}

export const offlineData = {
  isOffline: offlineEnabled,

  async getStudyQueue(
    deckId: string,
    params?: { limit?: number; newLimit?: number },
  ): Promise<StudyQueueResponse> {
    return readWithOfflineFallback(
      () => api.getStudyQueue(deckId, params),
      async () => {
        const payload = await getLocalStudyQueuePayload(getPowerSync(), deckId, params);
        if (!payload) throw new Error("Deck not found");
        return payload as unknown as StudyQueueResponse;
      },
    );
  },

  async submitReview(
    cardId: string,
    body: SubmitReviewBody,
  ): Promise<SubmitReviewResponse> {
    if (!offlineEnabled) return api.submitReview(cardId, body);
    const userId = await requireUserId();
    const grade = "grade" in body ? body.grade : (body.rating as FsrsGrade);
    const result = await submitLocalReview(getPowerSync(), {
      userId,
      cardId,
      grade,
      clozeOrd: body.cloze_ord ?? 0,
    });
    return result as unknown as SubmitReviewResponse;
  },

  async restoreReview(
    cardId: string,
    body: ReviewRestoreBody = {},
  ): Promise<ReviewRestoreResponse> {
    if (!offlineEnabled) return api.restoreReview(cardId, body);
    const userId = await requireUserId();
    const restored = await restoreLocalReviewState(getPowerSync(), {
      userId,
      cardId,
      clozeOrd: body.cloze_ord ?? 0,
      reviewState: (body.review_state as CardReviewRow | null | undefined) ?? null,
      logAction: body.log_action ?? "delete_latest",
      log: body.log as Record<string, unknown> | undefined,
    });
    return restored as ReviewRestoreResponse;
  },

  async suspendCard(cardId: string, suspended: boolean) {
    if (!offlineEnabled) return api.suspendCard(cardId, suspended);
    const userId = await requireUserId();
    await suspendLocalCard(getPowerSync(), { userId, cardId, suspended });
    return { ok: true };
  },

  async listDecks(): Promise<StudyDecksResponse> {
    return readWithOfflineFallback(
      () => api.listDecks(),
      async () => ({ decks: await getLocalStudyDeckOptions(getPowerSync()) }),
    );
  },

  async getDashboardStats(): Promise<DashboardStats> {
    return readWithOfflineFallback(
      () => api.getDashboardStats(),
      async () => (await getLocalDashboardStats(getPowerSync())) as unknown as DashboardStats,
    );
  },

  async getReviewHeatmap(year?: number): Promise<ReviewHeatmapData> {
    return readWithOfflineFallback(
      () => api.getReviewHeatmap(year),
      () => getLocalReviewHeatmap(getPowerSync(), year),
    );
  },

  async getCramQueue(
    planId: string,
    params?: { limit?: number; continuePastBudget?: boolean },
  ): Promise<CramQueueResponse> {
    return readWithOfflineFallback(
      () => api.getCramQueue(planId, params),
      async () => {
        const payload = await getLocalCramQueuePayload(getPowerSync(), planId, params);
        if (!payload) throw new Error("Cram Plan is not active");
        return payload as unknown as CramQueueResponse;
      },
    );
  },

  async browseCards(params?: {
    deck_id?: string;
    tag?: string;
    q?: string;
    limit?: number;
    offset?: number;
    filters?: boolean;
  }): Promise<BrowseCardsResponse> {
    return readWithOfflineFallback(
      () => api.browseCards(params),
      async () => (await browseLocalCards(getPowerSync(), params)) as unknown as BrowseCardsResponse,
    );
  },

  async browseBatch(body: {
    action: "suspend" | "unsuspend" | "delete";
    card_ids: string[];
  }): Promise<{ ok: boolean }> {
    if (!offlineEnabled) {
      await api.browseBatch(body);
      return { ok: true };
    }
    const userId = await requireUserId();
    await batchLocalCardAction(getPowerSync(), {
      userId,
      action: body.action,
      cardIds: body.card_ids,
    });
    return { ok: true };
  },

  async listProjects(): Promise<Project[]> {
    return readWithOfflineFallback(
      () => api.listProjects(),
      async () => (await listLocalProjects(getPowerSync())) as unknown as Project[],
    );
  },

  async getCard(cardId: string): Promise<BrowseCardRow> {
    return readWithOfflineFallback(
      () => api.getCard(cardId),
      async () => {
        const card = await getLocalBrowseCard(getPowerSync(), cardId);
        if (!card) throw new Error("Card not found");
        return card as unknown as BrowseCardRow;
      },
    );
  },

  async updateCard(cardId: string, body: CardUpdateBody): Promise<DraftCard> {
    if (!offlineEnabled) return api.updateCard(cardId, body);
    await updateLocalCard(getPowerSync(), cardId, body);
    const card = await getLocalBrowseCard(getPowerSync(), cardId);
    if (!card) throw new Error("Card not found");
    return card as unknown as DraftCard;
  },

  async deleteCard(cardId: string): Promise<void> {
    if (!offlineEnabled) return api.deleteCard(cardId);
    await deleteLocalCard(getPowerSync(), cardId);
  },

  async createCard(body: CreateCardBody): Promise<DraftCard> {
    if (!offlineEnabled) return api.createCard(body);
    const { project_id: projectId, append, ...fields } = body;
    const created = await createLocalCard(getPowerSync(), {
      projectId,
      append,
      ...fields,
    });
    const card = await getLocalBrowseCard(getPowerSync(), created.id);
    return (card ?? { id: created.id }) as unknown as DraftCard;
  },

  async submitCramReview(
    planId: string,
    body: { item_id: string; rating: 1 | 2 | 3 | 4; response_ms?: number },
  ): Promise<CramReviewResponse> {
    if (!offlineEnabled) {
      return api.submitCramReview(planId, {
        item_id: body.item_id,
        rating: body.rating,
        response_ms: body.response_ms ?? 0,
      });
    }
    const userId = await requireUserId();
    const result = await submitLocalCramReview(getPowerSync(), {
      userId,
      planId,
      itemId: body.item_id,
      rating: body.rating,
      responseMs: body.response_ms,
    });
    return result as unknown as CramReviewResponse;
  },
};
