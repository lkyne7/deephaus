export interface LocalRoutingState {
  online: boolean;
  forceLocal?: boolean;
  hasPendingWrites?: boolean;
  hasSyncedData?: boolean;
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
 * Writes are local once the replica has synced, while a local queue exists, or
 * when there is no network path. Before first sync, online writes must use the
 * server because existing local rows may not have downloaded yet.
 */
export function shouldUseLocalWrite(state: LocalRoutingState): boolean {
  return (
    state.forceLocal === true ||
    !state.online ||
    state.hasPendingWrites === true ||
    state.hasSyncedData === true
  );
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
