import "react-native-get-random-values";
import { PowerSyncDatabase } from "@powersync/react-native";
import {
  APP_SCHEMA,
  getLocalOwnerIds,
  hasSyncedPastServerWrite,
  localDataNeedsReset,
  SupabaseConnector,
} from "@deephaus/local-db";
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
let latestServerWriteAt = 0;
let lifecycleOperation: Promise<void> = Promise.resolve();
let pendingConnect: Promise<void> | null = null;

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

async function prepareDatabaseForUser(
  database: PowerSyncDatabase,
  userId: string,
): Promise<void> {
  await database.waitForReady();
  if (activeUserId === userId) return;

  // SQLite survives restarts while activeUserId does not. Validate persisted
  // ownership before any local route can read or mutate the replica.
  const localOwnerIds = await getLocalOwnerIds(database);
  if (localDataNeedsReset(localOwnerIds, activeUserId, userId)) {
    await database.disconnectAndClear();
    latestServerWriteAt = 0;
  }
  activeUserId = userId;
}

export function ensurePowerSyncAccountReady(userId: string): Promise<void> {
  if (!offlineEnabled) return Promise.resolve();
  // Fast path: the replica is already validated for this account. Skipping the
  // lifecycle queue keeps every read/write from stalling behind an in-flight
  // network connect or teardown enqueued ahead of it.
  if (activeUserId === userId) return Promise.resolve();
  return serializeLifecycle(() =>
    prepareDatabaseForUser(getPowerSync(), userId),
  );
}

export function connectPowerSync(userId: string): Promise<void> {
  let connectResult: Promise<void> = Promise.resolve();
  return serializeLifecycle(async () => {
    if (!offlineEnabled) return;
    const database = getPowerSync();
    await prepareDatabaseForUser(database, userId);
    if (database.connected) return;
    if (pendingConnect) {
      connectResult = pendingConnect;
      return;
    }
    // Run the sync-service handshake outside the lifecycle queue so local
    // reads and writes never wait on the network. Callers still observe the
    // handshake result through the returned promise.
    const connect = database
      .connect(
        new SupabaseConnector({ client: supabase, powersyncUrl: POWERSYNC_URL }),
      )
      .finally(() => {
        if (pendingConnect === connect) pendingConnect = null;
      });
    pendingConnect = connect;
    connectResult = connect;
  }).then(() => connectResult);
}

/**
 * Disconnect and normally wipe local data on sign-out. If auth expires while
 * offline, preserve queued writes so the same account can sign back in and
 * resume uploading them; a different account is still cleared on connect.
 */
export function teardownPowerSync(
  preservePendingWrites = false,
): Promise<void> {
  return serializeLifecycle(async () => {
    if (!db) return;
    // Let an in-flight handshake settle so a late connect can't resurrect the
    // stream after the local data is cleared.
    if (pendingConnect) await pendingConnect.catch(() => undefined);
    if (preservePendingWrites) {
      const stats = await db.getUploadQueueStats();
      if (stats.count > 0) {
        await db.disconnect();
        return;
      }
    }
    await db.disconnectAndClear();
    activeUserId = null;
    latestServerWriteAt = 0;
  });
}

export async function hasPendingPowerSyncWrites(): Promise<boolean> {
  if (!offlineEnabled || !db) return false;
  const stats = await db.getUploadQueueStats();
  return stats.count > 0;
}

/** A completed initial sync makes local rows safe for authoritative writes. */
export function hasSyncedPowerSyncData(): boolean {
  return hasSyncedPastServerWrite(
    db?.currentStatus.hasSynced,
    db?.currentStatus.lastSyncedAt,
    latestServerWriteAt,
  );
}

/** Hold writes on the API until a post-mutation sync checkpoint arrives. */
export function markPowerSyncServerWrite(): void {
  if (offlineEnabled) latestServerWriteAt = Date.now();
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
