export interface LocalRoutingState {
  online: boolean;
  forceLocal?: boolean;
  hasPendingWrites?: boolean;
  /** The replica has a sync checkpoint at or after the last server write. */
  hasSyncedData?: boolean;
  /** The replica has completed at least one full sync, ever. */
  hasSyncedOnce?: boolean;
}

/** Reads are local offline, after transport failure, or while writes await upload. */
export function shouldUseLocalRead(state: LocalRoutingState): boolean {
  return (
    state.forceLocal === true ||
    !state.online ||
    state.hasPendingWrites === true
  );
}

/**
 * Writes are local once the replica has synced past the last server write,
 * while a local queue exists, or when there is no network path. Before the
 * first full sync ever completes, writes must always use the server: a local
 * write against an empty or partially-downloaded replica would either fail
 * ("not found") or create rows that conflict with undownloaded server state.
 */
export function shouldUseLocalWrite(state: LocalRoutingState): boolean {
  if (state.hasPendingWrites === true) return true;
  if (state.hasSyncedData === true) return true;
  if (!state.online || state.forceLocal === true) {
    // Offline the local replica is the only option, but only once it has
    // completed a first sync. Within the replication-lag window after a server
    // write (hasSyncedData false, hasSyncedOnce true) a stale-version grade is
    // possible; the connector discards it on conflict rather than wedging.
    return state.hasSyncedOnce === true;
  }
  return false;
}

/** True only when the replica has a checkpoint at or after the last API write. */
export function hasSyncedPastServerWrite(
  hasSynced: boolean | undefined,
  lastSyncedAt: Date | undefined,
  latestServerWriteAt: number,
): boolean {
  if (!hasSynced) return false;
  if (latestServerWriteAt === 0) return true;
  return (lastSyncedAt?.getTime() ?? 0) >= latestServerWriteAt;
}
