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
import { api } from "./api";
import { loadStoredSession } from "./auth-session";
import { getPowerSync, offlineEnabled } from "./powersync";

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
    if (!offlineEnabled) return api.getStudyQueue(deckId, params);
    const payload = await getLocalStudyQueuePayload(getPowerSync(), deckId, params);
    if (!payload) throw new Error("Deck not found");
    return payload as unknown as StudyQueueResponse;
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
    await restoreLocalReviewState(getPowerSync(), {
      userId,
      cardId,
      clozeOrd: body.cloze_ord ?? 0,
      reviewState: (body.review_state as CardReviewRow | null | undefined) ?? null,
      logAction: body.log_action ?? "delete_latest",
      log: body.log as Record<string, unknown> | undefined,
    });
    return { ok: true };
  },

  async suspendCard(cardId: string, suspended: boolean) {
    if (!offlineEnabled) return api.suspendCard(cardId, suspended);
    const userId = await requireUserId();
    await suspendLocalCard(getPowerSync(), { userId, cardId, suspended });
    return { ok: true };
  },

  async listDecks(): Promise<StudyDecksResponse> {
    if (!offlineEnabled) return api.listDecks();
    const decks = await getLocalStudyDeckOptions(getPowerSync());
    return { decks };
  },

  async getDashboardStats(): Promise<DashboardStats> {
    if (!offlineEnabled) return api.getDashboardStats();
    const stats = await getLocalDashboardStats(getPowerSync());
    return stats as unknown as DashboardStats;
  },

  async getReviewHeatmap(year?: number): Promise<ReviewHeatmapData> {
    if (!offlineEnabled) return api.getReviewHeatmap(year);
    return getLocalReviewHeatmap(getPowerSync(), year);
  },

  async getCramQueue(
    planId: string,
    params?: { limit?: number; continuePastBudget?: boolean },
  ): Promise<CramQueueResponse> {
    if (!offlineEnabled) return api.getCramQueue(planId, params);
    const payload = await getLocalCramQueuePayload(getPowerSync(), planId, params);
    if (!payload) throw new Error("Cram Plan is not active");
    return payload as unknown as CramQueueResponse;
  },

  async browseCards(params?: {
    deck_id?: string;
    tag?: string;
    q?: string;
    limit?: number;
    offset?: number;
    filters?: boolean;
  }): Promise<BrowseCardsResponse> {
    if (!offlineEnabled) return api.browseCards(params);
    const result = await browseLocalCards(getPowerSync(), params);
    return result as unknown as BrowseCardsResponse;
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
    if (!offlineEnabled) return api.listProjects();
    const projects = await listLocalProjects(getPowerSync());
    return projects as unknown as Project[];
  },

  async getCard(cardId: string): Promise<BrowseCardRow> {
    if (!offlineEnabled) return api.getCard(cardId);
    const card = await getLocalBrowseCard(getPowerSync(), cardId);
    if (!card) throw new Error("Card not found");
    return card as unknown as BrowseCardRow;
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
