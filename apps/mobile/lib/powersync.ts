import "react-native-get-random-values";
import { PowerSyncDatabase } from "@powersync/react-native";
import { APP_SCHEMA, SupabaseConnector } from "@deephaus/local-db";
import Constants from "expo-constants";
import { supabase } from "./config";

const extra = Constants.expoConfig?.extra as { powersyncUrl?: string } | undefined;

function readConfigValue(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (!value || value.startsWith("${")) continue;
    return value;
  }
  return "";
}

export const POWERSYNC_URL = readConfigValue(
  process.env.EXPO_PUBLIC_POWERSYNC_URL,
  extra?.powersyncUrl,
);

/** Offline-first data layer is active only once the PowerSync instance is configured. */
export const offlineEnabled = POWERSYNC_URL.length > 0;

let db: PowerSyncDatabase | null = null;
let activeUserId: string | null = null;
let lifecycleOperation: Promise<void> = Promise.resolve();

export function getPowerSync(): PowerSyncDatabase {
  if (!db) {
    db = new PowerSyncDatabase({
      schema: APP_SCHEMA,
      database: { dbFilename: "deephaus.sqlite" },
    });
  }
  return db;
}

function serializeLifecycle(operation: () => Promise<void>): Promise<void> {
  const next = lifecycleOperation.then(operation, operation);
  lifecycleOperation = next.catch(() => undefined);
  return next;
}

export function connectPowerSync(userId: string): Promise<void> {
  return serializeLifecycle(async () => {
    if (!offlineEnabled) return;
    const database = getPowerSync();

    // A direct account switch can arrive without an intermediate signed-out
    // render. Never reconnect another user against the previous user's rows.
    if (activeUserId && activeUserId !== userId) {
      await database.disconnectAndClear();
      activeUserId = null;
    }

    if (database.connected && activeUserId === userId) return;
    await database.connect(
      new SupabaseConnector({ client: supabase, powersyncUrl: POWERSYNC_URL }),
    );
    activeUserId = userId;
  });
}

/** Disconnect and wipe local data (sign-out on a possibly shared device). */
export function teardownPowerSync(): Promise<void> {
  return serializeLifecycle(async () => {
    if (!db) return;
    await db.disconnectAndClear();
    activeUserId = null;
  });
}

export async function hasPendingPowerSyncWrites(): Promise<boolean> {
  if (!offlineEnabled || !db) return false;
  const stats = await db.getUploadQueueStats();
  return stats.count > 0;
}

/**
 * Give the active connection a short opportunity to upload pending writes.
 * Returns false instead of clearing data when the device is offline or sync
 * is unhealthy, allowing sign-out to be blocked without losing reviews.
 */
export async function waitForPowerSyncUploads(timeoutMs = 8_000): Promise<boolean> {
  if (!offlineEnabled || !db) return true;
  const startedAt = Date.now();
  while (await hasPendingPowerSyncWrites()) {
    if (!db.connected || db.currentStatus.uploadError || Date.now() - startedAt >= timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return true;
}
