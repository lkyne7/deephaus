import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConnectorOptions {
  client: SupabaseClient;
  powersyncUrl: string;
  uploadAuth?: { userId: string; url: string; anonKey: string };
}

/**
 * Columns that are jsonb / arrays in Postgres but JSON strings in the local
 * SQLite replica, and booleans stored locally as 0/1. Upload payloads must be
 * converted back before hitting the Data API.
 */
const JSON_COLUMNS: Record<string, string[]> = {
  projects: ["settings"],
  sources: ["edited_content"],
  cards: ["tags", "occlusion_data"],
  review_logs: ["response_payload", "next_state", "previous_state"],
  cram_plans: ["selection_spec"],
  cram_plan_deck_profiles: ["fsrs_params"],
  cram_review_logs: ["previous_state", "next_state"],
  user_fsrs_params: ["params"],
};

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  sources: ["extract_images", "is_favorite"],
  cards: ["user_edited"],
  card_reviews: ["suspended"],
  review_logs: ["undone"],
  cram_plans: ["deadline_has_time"],
};

/** Required by apply_card_review's p_review payload for an existing row. */
const CARD_REVIEW_RPC_COLUMNS = [
  "due",
  "stability",
  "difficulty",
  "elapsed_days",
  "scheduled_days",
  "reps",
  "lapses",
  "state",
] as const;

/** Tables synced with `user_id AS id`; uploads must target user_id instead. */
const USER_KEYED_TABLES = new Set(["user_study_settings", "user_fsrs_params"]);

/** Tables clients may write. Anything else in the CRUD queue is a bug. */
const WRITABLE_TABLES = new Set([
  "projects",
  "sources",
  "generation_jobs",
  "cards",
  "card_reviews",
  "review_logs",
  "cram_plans",
  "cram_plan_deck_profiles",
  "cram_plan_items",
  "cram_review_logs",
  "user_study_settings",
  "user_fsrs_params",
]);

function transformPayload(table: string, data: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...data };
  for (const col of JSON_COLUMNS[table] ?? []) {
    const value = payload[col];
    if (typeof value === "string" && value.length > 0) {
      try {
        payload[col] = JSON.parse(value);
      } catch {
        // Leave as-is; Postgres will reject and surface the real error.
      }
    }
  }
  for (const col of BOOLEAN_COLUMNS[table] ?? []) {
    const value = payload[col];
    if (typeof value === "number") payload[col] = value !== 0;
  }
  return payload;
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  private client: SupabaseClient;
  private powersyncUrl: string;
  private uploadClient: SupabaseClient;
  private uploadAuth: SupabaseConnectorOptions["uploadAuth"];

  constructor(options: SupabaseConnectorOptions) {
    this.client = options.client;
    this.uploadClient = options.client;
    this.uploadAuth = options.uploadAuth;
    this.powersyncUrl = options.powersyncUrl;
  }

  async fetchCredentials() {
    const {
      data: { session },
    } = await this.client.auth.getSession();
    if (
      !session ||
      (this.uploadAuth && session.user.id !== this.uploadAuth.userId)
    )
      return null;

    // Handing PowerSync a token that expires within the refresh margin causes a
    // guaranteed 401 on /sync/stream followed by a reconnect loop (observed as
    // repeated PSYNC_S2103 "JWT has expired" service errors when the mobile app
    // foregrounds). Refresh proactively instead of racing the SDK's lazy
    // refresh; if the refresh fails (e.g. offline), report "no credentials" so
    // PowerSync backs off and retries rather than burning a doomed request.
    const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
    if (expiresInMs < 60_000) {
      const { data, error } = await this.client.auth.refreshSession();
      if (!error && data.session) {
        return {
          endpoint: this.powersyncUrl,
          token: data.session.access_token,
        };
      }
      if (expiresInMs <= 0) return null;
    }

    return {
      endpoint: this.powersyncUrl,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    if (this.uploadAuth) {
      const {
        data: { session },
      } = await this.client.auth.getSession();
      if (
        !session ||
        session.user.id !== this.uploadAuth.userId ||
        (session.expires_at ?? 0) * 1000 <= Date.now()
      )
        throw new Error(
          "Sign back into the original account to upload its saved changes.",
        );
      // Pin the JWT for this transaction. A concurrent account switch must not
      // make a no-op RLS DELETE look like a successful upload under another user.
      this.uploadClient = createClient(
        this.uploadAuth.url,
        this.uploadAuth.anonKey,
        {
          global: {
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );
    }

    try {
      if (await this.applyUndoTransaction(transaction.crud)) {
        await transaction.complete();
        return;
      }
      if (await this.applyCardReviewTransaction(transaction.crud)) {
        await transaction.complete();
        return;
      }
      if (await this.applyCramReviewTransaction(transaction.crud)) {
        await transaction.complete();
        return;
      }
    } catch (error) {
      // Never acknowledge a review that the server did not persist. Older
      // servers may still return a version conflict during staged rollout.
      throw error;
    }

    // A cram review is represented by an item PATCH plus an audit-log PUT.
    // Apply the version-checked item first so a stale device cannot leave an
    // orphan log before PostgreSQL rejects the conflicting state update.
    const hasCramItem = transaction.crud.some(
      (entry) => entry.table === "cram_plan_items",
    );
    const hasCramLog = transaction.crud.some(
      (entry) => entry.table === "cram_review_logs",
    );
    const entries =
      hasCramItem && hasCramLog
        ? [...transaction.crud].sort((a, b) => {
            const priority = (entry: CrudEntry) => {
              if (entry.table === "cram_plan_items") return 0;
              if (entry.table === "cram_review_logs") return 2;
              return 1;
            };
            return priority(a) - priority(b);
          })
        : transaction.crud;
    for (const entry of entries) {
      await this.applyEntry(entry);
    }
    await transaction.complete();
  }

  private async applyUndoTransaction(
    entries: readonly CrudEntry[],
  ): Promise<boolean> {
    const entry = entries.find(
      (item) =>
        item.table === "review_logs" &&
        (item.op === UpdateType.DELETE ||
          (item.op === UpdateType.PATCH && "undone" in (item.opData ?? {}))),
    );
    if (
      !entry ||
      entries.some((item) => item !== entry && item.table !== "card_reviews")
    )
      return false;
    const { data, error } = await this.uploadClient
      .from("review_logs")
      .select("card_id, cloze_ord")
      .eq("id", entry.id)
      .single();
    if (error || !data) throw error ?? new Error("Review has not synced yet");
    const response = await this.uploadClient.rpc("restore_card_review", {
      p_card_id: data.card_id,
      p_cloze_ord: data.cloze_ord,
      p_log_id: entry.id,
      p_undone:
        entry.op === UpdateType.DELETE || Number(entry.opData?.undone) === 1,
    });
    if (response.error) throw response.error;
    return true;
  }

  private async applyCardReviewTransaction(
    entries: readonly CrudEntry[],
  ): Promise<boolean> {
    // Take the RPC fast path only for a transaction that is exactly the review
    // pair. A looser table-membership match would apply the pair and silently
    // drop any sibling entries batched into the same local transaction.
    if (entries.length !== 2) return false;
    const reviewEntry = entries.find(
      (entry) =>
        entry.table === "card_reviews" &&
        (entry.op === UpdateType.PATCH || entry.op === UpdateType.PUT),
    );
    const logEntry = entries.find(
      (entry) => entry.table === "review_logs" && entry.op === UpdateType.PUT,
    );
    if (!reviewEntry || !logEntry) return false;

    const logPayload = transformPayload(logEntry.table, logEntry.opData ?? {});
    const userId = logPayload.user_id;
    const cardId = logPayload.card_id;
    const clozeOrd = Number(logPayload.cloze_ord ?? 0);
    const expectedVersion = Number(logPayload.base_version ?? 0);

    if (
      typeof userId !== "string" ||
      typeof cardId !== "string" ||
      !Number.isInteger(clozeOrd) ||
      !Number.isInteger(expectedVersion)
    ) {
      throw new Error("[local-db] Malformed queued card review transaction");
    }

    let reviewData =
      (logPayload.next_state as Record<string, unknown> | undefined) ??
      reviewEntry.opData ??
      {};
    const isSparsePatch =
      !logPayload.next_state &&
      reviewEntry.op === UpdateType.PATCH &&
      CARD_REVIEW_RPC_COLUMNS.some((column) => !(column in reviewData));
    if (isSparsePatch) {
      // PowerSync PATCH entries only include columns whose SQLite values
      // changed. apply_card_review expects a complete next-state payload, so
      // hydrate unchanged required columns from the authoritative base row.
      // Reading the local row is unsafe because later queued grades may have
      // already advanced it beyond this transaction.
      const { data: baseReview, error: baseReviewError } = await this.client
        .from("card_reviews")
        .select(
          "id, card_id, user_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, version",
        )
        .eq("id", reviewEntry.id)
        .maybeSingle();
      if (baseReviewError) throw baseReviewError;
      if (!baseReview) {
        throw new Error(
          "[local-db] Cannot hydrate queued card review from the server",
        );
      }
      reviewData = { ...baseReview, ...reviewData };
    }

    const reviewPayload = transformPayload(reviewEntry.table, reviewData);
    reviewPayload.id = reviewEntry.id;
    const responsePayload =
      logPayload.response_payload &&
      typeof logPayload.response_payload === "object"
        ? logPayload.response_payload
        : {};
    const { error } = await this.uploadClient.rpc("apply_card_review", {
      p_user_id: userId,
      p_card_id: cardId,
      p_cloze_ord: clozeOrd,
      p_expected_version: expectedVersion,
      p_mutation_id: logEntry.id,
      p_review: reviewPayload,
      p_log: logPayload,
      p_response: responsePayload,
    });
    if (error) throw error;
    return true;
  }

  private async applyCramReviewTransaction(
    entries: readonly CrudEntry[],
  ): Promise<boolean> {
    // Exact-shape guard; see applyCardReviewTransaction.
    if (entries.length !== 2) return false;
    const itemEntry = entries.find(
      (entry) =>
        entry.table === "cram_plan_items" && entry.op === UpdateType.PATCH,
    );
    const logEntry = entries.find(
      (entry) =>
        entry.table === "cram_review_logs" && entry.op === UpdateType.PUT,
    );
    if (!itemEntry || !logEntry) return false;

    const itemPayload = transformPayload(
      itemEntry.table,
      itemEntry.opData ?? {},
    );
    const logPayload = transformPayload(logEntry.table, logEntry.opData ?? {});
    const previousState = logPayload.previous_state as
      | Record<string, unknown>
      | undefined;
    const nextState = logPayload.next_state as
      | Record<string, unknown>
      | undefined;
    const expectedVersion = Number(
      previousState?.version ?? Number(itemPayload.version) - 1,
    );
    const planId = logPayload.plan_id;
    const rating = Number(logPayload.rating);

    if (
      typeof planId !== "string" ||
      !nextState ||
      !Number.isInteger(expectedVersion) ||
      !Number.isInteger(rating)
    ) {
      throw new Error("[local-db] Malformed queued Cram review transaction");
    }

    const { error } = await this.uploadClient.rpc("record_synced_cram_review", {
      p_plan_id: planId,
      p_item_id: itemEntry.id,
      p_log_id: logEntry.id,
      p_rating: rating,
      p_expected_version: expectedVersion,
      p_next_state: nextState,
      p_log: logPayload,
      p_response_ms:
        typeof logPayload.response_ms === "number"
          ? logPayload.response_ms
          : null,
    });
    if (error) throw error;
    return true;
  }

  private async applyEntry(entry: CrudEntry): Promise<void> {
    if (!WRITABLE_TABLES.has(entry.table)) {
      // Retain the transaction in the queue. Silently completing it would
      // permanently discard the user's mutation and every caller would think
      // the change had synced successfully.
      throw new Error(
        `[local-db] Refusing write to non-writable table ${entry.table}`,
      );
    }

    const table = this.uploadClient.from(entry.table);
    const idColumn = USER_KEYED_TABLES.has(entry.table) ? "user_id" : "id";

    if (entry.op === UpdateType.PUT) {
      const payload = transformPayload(entry.table, entry.opData ?? {});
      payload[idColumn] = entry.id;
      if (idColumn !== "id") delete payload.id;
      const { error } = await table.upsert(payload, { onConflict: idColumn });
      if (error) throw error;
      return;
    }

    if (entry.op === UpdateType.PATCH) {
      if (!entry.opData || Object.keys(entry.opData).length === 0) return;
      const payload = transformPayload(entry.table, entry.opData);
      delete payload.id;
      const { error } = await table.update(payload).eq(idColumn, entry.id);
      if (error) throw error;
      return;
    }

    if (entry.op === UpdateType.DELETE) {
      const { error } = await table.delete().eq(idColumn, entry.id);
      if (error) throw error;
    }
  }
}
