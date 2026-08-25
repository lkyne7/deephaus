import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/common";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConnectorOptions {
  client: SupabaseClient;
  powersyncUrl: string;
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
  review_logs: ["response_payload"],
  cram_plans: ["selection_spec"],
  cram_plan_deck_profiles: ["fsrs_params"],
  cram_review_logs: ["previous_state", "next_state"],
  user_fsrs_params: ["params"],
};

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  sources: ["extract_images", "is_favorite"],
  cards: ["user_edited"],
  card_reviews: ["suspended"],
  cram_plans: ["deadline_has_time"],
};

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

  constructor(options: SupabaseConnectorOptions) {
    this.client = options.client;
    this.powersyncUrl = options.powersyncUrl;
  }

  async fetchCredentials() {
    const {
      data: { session },
    } = await this.client.auth.getSession();
    if (!session) return null;
    return {
      endpoint: this.powersyncUrl,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      if (await this.applyCardReviewTransaction(transaction.crud)) {
        await transaction.complete();
        return;
      }
      if (await this.applyCramReviewTransaction(transaction.crud)) {
        await transaction.complete();
        return;
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
    } catch (error) {
      // Never complete a failed transaction. Completing here discards every
      // write in the transaction, including unrelated reviews after a poison
      // entry. PowerSync retains the queue and exposes uploadError so the app
      // can surface the problem without silently losing user data.
      throw error;
    }
  }

  private async applyCardReviewTransaction(
    entries: readonly CrudEntry[],
  ): Promise<boolean> {
    const reviewEntry = entries.find(
      (entry) =>
        entry.table === "card_reviews" &&
        (entry.op === UpdateType.PATCH || entry.op === UpdateType.PUT),
    );
    const logEntry = entries.find(
      (entry) => entry.table === "review_logs" && entry.op === UpdateType.PUT,
    );
    if (!reviewEntry || !logEntry) return false;

    const reviewPayload = transformPayload(
      reviewEntry.table,
      reviewEntry.opData ?? {},
    );
    reviewPayload.id = reviewEntry.id;
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

    const responsePayload =
      logPayload.response_payload &&
      typeof logPayload.response_payload === "object"
        ? logPayload.response_payload
        : {};
    const { error } = await this.client.rpc("apply_card_review", {
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

    const { error } = await this.client.rpc("record_synced_cram_review", {
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

    const table = this.client.from(entry.table);
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
