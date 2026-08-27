"use client";

import {
  APP_SCHEMA,
  createSyncLogger,
  getLocalOwnerIds,
  hasSyncedPastServerWrite,
  localDataNeedsReset,
  SupabaseConnector,
} from "@deephaus/local-db";
import { PowerSyncDatabase } from "@powersync/web";
import { createClient } from "@/lib/supabase/client";

export const POWERSYNC_URL = process.env.NEXT_PUBLIC_POWERSYNC_URL ?? "";

/** Offline-first data layer is active only once the PowerSync instance is configured. */
export const offlineEnabled =
  typeof window !== "undefined" && POWERSYNC_URL.length > 0;

let db: PowerSyncDatabase | null = null;
let activeUserId: string | null = null;
let latestServerWriteAt = 0;
let lifecycleOperation: Promise<void> = Promise.resolve();

export function getPowerSync(): PowerSyncDatabase {
  if (!db) {
    db = new PowerSyncDatabase({
      schema: APP_SCHEMA,
      logger: createSyncLogger(),
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

function serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const next = lifecycleOperation.then(operation, operation);
  lifecycleOperation = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function prepareDatabaseForUser(
  database: PowerSyncDatabase,
  userId: string,
): Promise<void> {
  await database.waitForReady();
  if (activeUserId === userId) return;

  // The SQLite/OPFS database survives reloads, but activeUserId does not.
  // Inspect persisted rows before exposing local routes to the current user.
  const localOwnerIds = await getLocalOwnerIds(database);
  if (localDataNeedsReset(localOwnerIds, activeUserId, userId)) {
    await database.disconnectAndClear();
    latestServerWriteAt = 0;
  }
  activeUserId = userId;
}

async function currentSession() {
  const client = createClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  return { client, userId: session?.user.id ?? null };
}

/**
 * Gate local reads/writes until the persisted database has been validated for
 * the current session. This closes the render-before-effect window on login.
 */
export async function ensurePowerSyncAccountReady(): Promise<boolean> {
  if (!offlineEnabled) return false;
  return serializeLifecycle(async () => {
    const { userId } = await currentSession();
    if (!userId) return false;
    await prepareDatabaseForUser(getPowerSync(), userId);
    return true;
  });
}

export function connectPowerSync(): Promise<void> {
  if (!offlineEnabled) return Promise.resolve();
  return serializeLifecycle(async () => {
    const { client, userId } = await currentSession();
    if (!userId) return;
    const database = getPowerSync();
    await prepareDatabaseForUser(database, userId);
    if (database.connected) return;
    await database.connect(
      new SupabaseConnector({ client, powersyncUrl: POWERSYNC_URL }),
    );
  });
}

/**
 * Disconnect and normally wipe local data on sign-out. Auth can also emit a
 * spontaneous SIGNED_OUT event when a refresh token is revoked; in that case,
 * preserve queued offline work so signing back into the same account can
 * resume the upload. A different account is still cleared on connect.
 */
export function teardownPowerSync(
  preservePendingWrites = false,
): Promise<void> {
  return serializeLifecycle(async () => {
    if (!db) return;
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

/** The replica has completed at least one full sync (ignores the server-write watermark). */
export function hasPowerSyncSyncedOnce(): boolean {
  return db?.currentStatus.hasSynced === true;
}

/**
 * Keep writes server-side until PowerSync completes a download after a server
 * mutation made during initial sync. This avoids grading the next card from a
 * local row that predates the previous server-side grade.
 */
export function markPowerSyncServerWrite(): void {
  if (offlineEnabled) latestServerWriteAt = Date.now();
}

/**
 * Give pending writes a chance to upload before sign-out clears the database.
 * Returning false lets the UI block sign-out instead of deleting offline work.
 */
export async function waitForPowerSyncUploads(
  timeoutMs = 8_000,
): Promise<boolean> {
  if (!offlineEnabled || !db) return true;
  const startedAt = Date.now();
  while (await hasPendingPowerSyncWrites()) {
    if (
      !db.connected ||
      db.currentStatus.uploadError ||
      Date.now() - startedAt >= timeoutMs
    ) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return true;
}
