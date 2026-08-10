"use client";

import { APP_SCHEMA, SupabaseConnector } from "@deephaus/local-db";
import { PowerSyncDatabase } from "@powersync/web";
import { createClient } from "@/lib/supabase/client";

export const POWERSYNC_URL = process.env.NEXT_PUBLIC_POWERSYNC_URL ?? "";

/** Offline-first data layer is active only once the PowerSync instance is configured. */
export const offlineEnabled =
  typeof window !== "undefined" && POWERSYNC_URL.length > 0;

let db: PowerSyncDatabase | null = null;
let connected = false;

/** Whether the local replica has finished opening and its connector is active. */
export function isPowerSyncReady(): boolean {
  return connected;
}

export function getPowerSync(): PowerSyncDatabase {
  if (!db) {
    db = new PowerSyncDatabase({
      schema: APP_SCHEMA,
      database: {
        dbFilename: "deephaus.sqlite",
        // Pre-bundled workers copied to public/@powersync by `powersync-web
        // copy-assets` (Turbopack cannot bundle dynamic worker imports).
        worker: "/@powersync/worker.js",
      },
      sync: { worker: "/@powersync/worker.js" },
    });
  }
  return db;
}

export async function connectPowerSync(): Promise<void> {
  if (!offlineEnabled || connected) return;
  const database = getPowerSync();
  await database.connect(
    new SupabaseConnector({ client: createClient(), powersyncUrl: POWERSYNC_URL }),
  );
  connected = true;
}

/** Disconnect and wipe local data (sign-out on a possibly shared device). */
export async function teardownPowerSync(): Promise<void> {
  if (!db) return;
  connected = false;
  await db.disconnectAndClear();
}
