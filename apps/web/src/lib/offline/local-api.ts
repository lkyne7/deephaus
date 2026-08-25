"use client";

import { sourceDocToPlainText } from "@deephaus/rich-text";
import type { JSONContent } from "@tiptap/core";
import {
  batchLocalCardAction,
  browseLocalCards,
  createLocalCard,
  deleteLocalCard,
  getLocalBrowseCard,
  getLocalBrowseFilters,
  getLocalCramQueuePayload,
  getLocalDashboardStats,
  getLocalReviewHeatmap,
  getLocalSourceDocument,
  getLocalStudyDeckOptions,
  getLocalStudyQueuePayload,
  listLocalProjects,
  restoreLocalReviewState,
  saveLocalSourceDocument,
  shouldUseLocalRead,
  shouldUseLocalWrite,
  submitLocalCramReview,
  submitLocalReview,
  suspendLocalCard,
  updateLocalCard,
  type LocalCardUpdateFields,
} from "@deephaus/local-db";
import type { CardReviewRow, FsrsGrade, GradeLabel } from "@deephaus/scheduling";
import {
  ensurePowerSyncAccountReady,
  getPowerSync,
  hasPendingPowerSyncWrites,
  hasSyncedPowerSyncData,
  offlineEnabled,
} from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";

async function requireUserId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not signed in");
  return userId;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    const parsed = JSON.parse(init.body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Handlers may return null to fall through to the network. */
type Handler = (
  match: RegExpMatchArray,
  search: URLSearchParams,
  init?: RequestInit,
) => Promise<Response | null>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: "GET",
    pattern: /^\/api\/stats\/dashboard$/,
    handler: async () => json(await getLocalDashboardStats(getPowerSync())),
  },
  {
    method: "GET",
    pattern: /^\/api\/stats\/heatmap$/,
    handler: async (_match, search) => {
      const yearParam = search.get("year");
      const year = yearParam ? Number.parseInt(yearParam, 10) : undefined;
      return json(
        await getLocalReviewHeatmap(
          getPowerSync(),
          Number.isFinite(year) ? year : undefined,
        ),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/decks$/,
    handler: async () => json({ decks: await getLocalStudyDeckOptions(getPowerSync()) }),
  },
  {
    method: "GET",
    pattern: /^\/api\/decks$/,
    handler: async () => {
      const projects = await listLocalProjects(getPowerSync());
      return json({
        decks: projects.map((project) => ({
          id: project.id,
          name: project.deck_name || project.name,
        })),
      });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/projects$/,
    handler: async () => json(await listLocalProjects(getPowerSync())),
  },
  {
    method: "GET",
    pattern: /^\/api\/projects\/([^/]+)$/,
    handler: async (match) => {
      const projects = await listLocalProjects(getPowerSync());
      const project = projects.find((candidate) => candidate.id === match[1]);
      return project
        ? json(project)
        : json({ error: "Deck not found" }, 404);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/decks\/([^/]+)\/review$/,
    handler: async (match, search) => {
      const limit = search.get("limit");
      const newLimit = search.get("newLimit");
      const payload = await getLocalStudyQueuePayload(getPowerSync(), match[1], {
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        newLimit: newLimit ? Number.parseInt(newLimit, 10) : undefined,
      });
      if (!payload) return json({ error: "Deck not found" }, 404);
      return json(payload);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/cards\/([^/]+)\/review$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      const userId = await requireUserId();
      const grade = (body.grade ?? body.rating) as GradeLabel | FsrsGrade | undefined;
      if (grade == null) return json({ error: "Missing grade" }, 400);
      const result = await submitLocalReview(getPowerSync(), {
        userId,
        cardId: match[1],
        grade,
        clozeOrd: typeof body.cloze_ord === "number" ? body.cloze_ord : 0,
        mutationId:
          typeof body.client_mutation_id === "string"
            ? body.client_mutation_id
            : crypto.randomUUID(),
      });
      return json(result);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/cards\/([^/]+)\/review\/restore$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      const userId = await requireUserId();
      const restored = await restoreLocalReviewState(getPowerSync(), {
        userId,
        cardId: match[1],
        clozeOrd: typeof body.cloze_ord === "number" ? body.cloze_ord : 0,
        reviewState: (body.review_state as CardReviewRow | null | undefined) ?? null,
        logAction:
          body.log_action === "insert" ? "insert" : "delete_latest",
        log: body.log as Record<string, unknown> | undefined,
      });
      return json(restored);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/cards\/([^/]+)\/suspend$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      const userId = await requireUserId();
      const suspended = body.suspended === true;
      await suspendLocalCard(getPowerSync(), { userId, cardId: match[1], suspended });
      return json({ suspended });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/cram-plans\/([^/]+)\/queue$/,
    handler: async (match, search) => {
      const limit = search.get("limit");
      const payload = await getLocalCramQueuePayload(getPowerSync(), match[1], {
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        continuePastBudget: search.get("continue") === "1",
      });
      if (!payload) return json({ error: "Cram Plan is not active" }, 404);
      return json(payload);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/cram-plans\/([^/]+)\/review$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      const userId = await requireUserId();
      if (typeof body.item_id !== "string" || typeof body.rating !== "number") {
        return json({ error: "Invalid body" }, 400);
      }
      const result = await submitLocalCramReview(getPowerSync(), {
        userId,
        planId: match[1],
        itemId: body.item_id,
        rating: body.rating as 1 | 2 | 3 | 4,
        responseMs: typeof body.response_ms === "number" ? body.response_ms : undefined,
      });
      return json(result);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/browse\/cards$/,
    handler: async (_match, search) => {
      const limit = search.get("limit");
      const offset = search.get("offset");
      return json(
        await browseLocalCards(getPowerSync(), {
          deck_id: search.get("deck_id") ?? undefined,
          tag: search.get("tag") ?? undefined,
          q: search.get("q") ?? undefined,
          limit: limit ? Number.parseInt(limit, 10) : undefined,
          offset: offset ? Number.parseInt(offset, 10) : undefined,
          filters: search.get("filters") === "1",
        }),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/browse\/filters$/,
    handler: async (_match, search) => {
      const filters = await getLocalBrowseFilters(
        getPowerSync(),
        search.get("deck_id") ?? undefined,
      );
      return json({ filters });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/browse\/batch$/,
    handler: async (_match, _search, init) => {
      const body = await readBody(init);
      const userId = await requireUserId();
      const action = body.action as "suspend" | "unsuspend" | "delete";
      const cardIds = Array.isArray(body.card_ids)
        ? body.card_ids.filter((id): id is string => typeof id === "string")
        : [];
      if (!["suspend", "unsuspend", "delete"].includes(action) || cardIds.length === 0) {
        return json({ error: "Invalid body" }, 400);
      }
      await batchLocalCardAction(getPowerSync(), { userId, action, cardIds });
      return json({ ok: true });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/cards$/,
    handler: async (_match, _search, init) => {
      const body = await readBody(init);
      if (typeof body.project_id !== "string") {
        return json({ error: "Invalid body" }, 400);
      }
      const created = await createLocalCard(getPowerSync(), {
        projectId: body.project_id,
        type: body.type as "basic" | "cloze" | "image-occlusion" | undefined,
        front: (body.front as string | null | undefined) ?? null,
        back: (body.back as string | null | undefined) ?? null,
        cloze_text: (body.cloze_text as string | null | undefined) ?? null,
        extra: (body.extra as string | null | undefined) ?? null,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
        occlusion_data: body.occlusion_data,
        source_ref: (body.source_ref as string | null | undefined) ?? null,
        source_quote: (body.source_quote as string | null | undefined) ?? null,
        append: body.append !== false,
      });
      const card = await getLocalBrowseCard(getPowerSync(), created.id);
      return json(card ?? { id: created.id });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/cards\/([^/]+)$/,
    handler: async (match) => {
      const card = await getLocalBrowseCard(getPowerSync(), match[1]);
      if (!card) return json({ error: "Card not found" }, 404);
      return json(card);
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/cards\/([^/]+)$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      await updateLocalCard(getPowerSync(), match[1], body as LocalCardUpdateFields);
      const card = await getLocalBrowseCard(getPowerSync(), match[1]);
      if (!card) return json({ error: "Card not found" }, 404);
      return json(card);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/cards\/([^/]+)$/,
    handler: async (match) => {
      await deleteLocalCard(getPowerSync(), match[1]);
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/sources\/([^/]+)\/document$/,
    handler: async (match) => {
      // Unseeded documents need server-side extraction; fall through.
      const doc = await getLocalSourceDocument(getPowerSync(), match[1]);
      if (!doc) return null;
      return json({
        content: doc.content,
        sourceType: doc.sourceType,
        contentEditedAt: doc.contentEditedAt,
        seeded: false,
      });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/sources\/([^/]+)\/document$/,
    handler: async (match, _search, init) => {
      const body = await readBody(init);
      const content = body.content as JSONContent | undefined;
      if (!content || typeof content !== "object" || content.type !== "doc") {
        return json({ error: "A ProseMirror doc is required" }, 400);
      }
      const result = await saveLocalSourceDocument(getPowerSync(), {
        sourceId: match[1],
        content,
        rawText: sourceDocToPlainText(content),
      });
      return json({ ok: true, contentEditedAt: result.contentEditedAt });
    },
  },
];

/**
 * Serve core study/cram/browse/dashboard API routes from the local PowerSync
 * replica when offline-first mode is configured. Returns null when the URL
 * isn't handled locally, so the caller falls through to the network.
 */
export async function tryLocalApi(
  input: string,
  init?: RequestInit,
  forceLocal = false,
): Promise<Response | null> {
  if (!offlineEnabled) return null;
  if (!(await ensurePowerSyncAccountReady())) return null;
  let url: URL;
  try {
    url = new URL(input, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;

  const method = (init?.method ?? "GET").toUpperCase();
  const hasPendingWrites = await hasPendingPowerSyncWrites();
  // Keep the server authoritative while online. A PowerSync connection can
  // open before its initial sync has populated SQLite; treating "connected" as
  // "ready" caused empty local results to replace real decks, cards, and notes.
  // Pending writes are the exception: local reads preserve read-your-writes
  // until the upload queue drains instead of flashing stale server data.
  if (
    method === "GET" &&
    !shouldUseLocalRead({
      online: navigator.onLine,
      forceLocal,
      hasPendingWrites,
    })
  ) {
    return null;
  }

  // Before the first sync, existing rows may not be present locally yet.
  // Send online mutations to the server until the replica is ready. If the
  // request races with a network outage, apiFetch retries here with forceLocal.
  if (
    method !== "GET" &&
    !shouldUseLocalWrite({
      online: navigator.onLine,
      forceLocal,
      hasPendingWrites,
      hasSyncedData: hasSyncedPowerSyncData(),
    })
  ) {
    return null;
  }

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    try {
      const response = await route.handler(match, url.searchParams, init);
      if (response) return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local request failed";
      return json({ error: message }, 500);
    }
  }
  return null;
}
