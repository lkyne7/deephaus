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
  CramPlanDetail,
  CramPlanListItem,
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
  generateUuid,
  getLocalBrowseCard,
  getLocalCramPlanDetailPayload,
  getLocalCramPlanListPayload,
  getLocalCramQueuePayload,
  getLocalDashboardStats,
  getLocalReviewHeatmap,
  getLocalStudyDeckOptions,
  getLocalStudyQueuePayload,
  listLocalProjects,
  restoreLocalReviewState,
  shouldUseLocalRead,
  shouldUseLocalWrite,
  submitLocalCramReview,
  submitLocalReview,
  suspendLocalCard,
  updateLocalCard,
} from "@deephaus/local-db";
import type { CardReviewRow, FsrsGrade } from "@deephaus/scheduling";
import { api } from "./api";
import { loadStoredSession } from "./auth-session";
import { getCachedNetworkState } from "./network-state";
import {
  ensurePowerSyncAccountReady,
  getPowerSync,
  hasPendingPowerSyncWrites,
  hasPowerSyncSyncedOnce,
  hasSyncedPowerSyncData,
  markPowerSyncServerWrite,
  offlineEnabled,
} from "./powersync";

async function ensureCurrentAccountReady(): Promise<boolean> {
  const session = await loadStoredSession();
  const userId = session?.user.id;
  if (!userId) return false;
  await ensurePowerSyncAccountReady(userId);
  return true;
}

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
  if (!(await ensureCurrentAccountReady())) return false;
  const hasPendingWrites = await hasPendingPowerSyncWrites();
  if (hasPendingWrites) return true;
  try {
    const state = await getCachedNetworkState();
    return shouldUseLocalRead({
      online:
        state.isConnected !== false && state.isInternetReachable !== false,
      hasPendingWrites,
    });
  } catch {
    return false;
  }
}

async function shouldWriteLocally(): Promise<boolean> {
  if (!offlineEnabled) return false;
  if (!(await ensureCurrentAccountReady())) return false;
  const hasPendingWrites = await hasPendingPowerSyncWrites();
  const hasSyncedData = hasSyncedPowerSyncData();
  if (hasPendingWrites || hasSyncedData) return true;
  try {
    const state = await getCachedNetworkState();
    return shouldUseLocalWrite({
      online:
        state.isConnected !== false && state.isInternetReachable !== false,
      hasPendingWrites,
      hasSyncedData,
      hasSyncedOnce: hasPowerSyncSyncedOnce(),
    });
  } catch {
    // Before the first local sync, the server is the only authoritative copy.
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
    // Client/auth errors are authoritative. Server outages and transport
    // failures may still use the last good local snapshot.
    if (
      !offlineEnabled ||
      (isApiError(error) && (error as { status: number }).status < 500)
    ) {
      throw error;
    }
    return local();
  }
}

async function writeWithOfflineFallback<T>(
  remote: () => Promise<T>,
  local: () => Promise<T>,
  options?: {
    /**
     * Disable the transport-failure fallback for non-idempotent creates: a
     * request that died mid-response may already have committed server-side,
     * and repeating it locally would produce a duplicate row after sync.
     */
    fallbackOnTransportError?: boolean;
  },
): Promise<T> {
  if (await shouldWriteLocally()) return local();
  try {
    const result = await remote();
    markPowerSyncServerWrite();
    return result;
  } catch (error) {
    // Validation/auth/RLS responses are authoritative. A transport failure may
    // have raced the connectivity check, so queue the same write locally.
    if (
      !offlineEnabled ||
      isApiError(error) ||
      options?.fallbackOnTransportError === false
    ) {
      throw error;
    }
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
    const mutationId = body.client_mutation_id ?? generateUuid();
    const requestBody = { ...body, client_mutation_id: mutationId };
    return writeWithOfflineFallback(
      () => api.submitReview(cardId, requestBody),
      async () => {
        const userId = await requireUserId();
        const grade =
          "grade" in requestBody ? requestBody.grade : (requestBody.rating as FsrsGrade);
        const result = await submitLocalReview(getPowerSync(), {
          userId,
          cardId,
          grade,
          clozeOrd: requestBody.cloze_ord ?? 0,
          mutationId,
        });
        return result as unknown as SubmitReviewResponse;
      },
    );
  },

  async restoreReview(
    cardId: string,
    body: ReviewRestoreBody = {},
  ): Promise<ReviewRestoreResponse> {
    return writeWithOfflineFallback(
      () => api.restoreReview(cardId, body),
      async () => {
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
    );
  },

  async suspendCard(cardId: string, suspended: boolean) {
    return writeWithOfflineFallback(
      () => api.suspendCard(cardId, suspended),
      async () => {
        const userId = await requireUserId();
        await suspendLocalCard(getPowerSync(), { userId, cardId, suspended });
        return { ok: true };
      },
    );
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

  async listCramPlans(): Promise<{ plans: CramPlanListItem[] }> {
    return readWithOfflineFallback(
      () => api.listCramPlans(),
      async () =>
        (await getLocalCramPlanListPayload(getPowerSync())) as {
          plans: CramPlanListItem[];
        },
    );
  },

  async getCramPlan(planId: string): Promise<CramPlanDetail> {
    return readWithOfflineFallback(
      () => api.getCramPlan(planId),
      async () => {
        const detail = await getLocalCramPlanDetailPayload(
          getPowerSync(),
          planId,
        );
        if (!detail) throw new Error("Cram Plan not found");
        return detail as CramPlanDetail;
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
    return writeWithOfflineFallback(
      async () => {
        await api.browseBatch(body);
        return { ok: true };
      },
      async () => {
        const userId = await requireUserId();
        await batchLocalCardAction(getPowerSync(), {
          userId,
          action: body.action,
          cardIds: body.card_ids,
        });
        return { ok: true };
      },
    );
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
    return writeWithOfflineFallback(
      () => api.updateCard(cardId, body),
      async () => {
        await updateLocalCard(getPowerSync(), cardId, body);
        const card = await getLocalBrowseCard(getPowerSync(), cardId);
        if (!card) throw new Error("Card not found");
        return card as unknown as DraftCard;
      },
    );
  },

  async deleteCard(cardId: string): Promise<void> {
    return writeWithOfflineFallback(
      () => api.deleteCard(cardId),
      () => deleteLocalCard(getPowerSync(), cardId),
    );
  },

  async createCard(body: CreateCardBody): Promise<DraftCard> {
    return writeWithOfflineFallback(
      () => api.createCard(body),
      async () => {
        const { project_id: projectId, append, ...fields } = body;
        const created = await createLocalCard(getPowerSync(), {
          userId: await requireUserId(),
          projectId,
          append,
          ...fields,
        });
        const card = await getLocalBrowseCard(getPowerSync(), created.id);
        return (card ?? { id: created.id }) as unknown as DraftCard;
      },
      { fallbackOnTransportError: false },
    );
  },

  async submitCramReview(
    planId: string,
    body: { item_id: string; rating: 1 | 2 | 3 | 4; response_ms?: number },
  ): Promise<CramReviewResponse> {
    return writeWithOfflineFallback(
      () =>
        api.submitCramReview(planId, {
          item_id: body.item_id,
          rating: body.rating,
          response_ms: body.response_ms ?? 0,
        }),
      async () => {
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
    );
  },
};
