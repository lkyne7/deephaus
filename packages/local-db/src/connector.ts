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
      for (const entry of transaction.crud) {
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

  private async applyEntry(entry: CrudEntry): Promise<void> {
    if (!WRITABLE_TABLES.has(entry.table)) {
      console.error(`[local-db] Dropping write to non-writable table ${entry.table}`);
      return;
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
