import type { AbstractPowerSyncDatabase } from "@powersync/common";

export function localDataNeedsReset(
  localOwnerIds: readonly string[],
  activeUserId: string | null,
  nextUserId: string,
): boolean {
  return (
    (activeUserId !== null && activeUserId !== nextUserId) ||
    localOwnerIds.some((ownerId) => ownerId !== nextUserId)
  );
}

/**
 * Return the distinct owners represented in the local replica.
 *
 * PowerSync databases persist across app/browser restarts, while module-level
 * connection state does not. Checking the rows themselves prevents a newly
 * signed-in account from briefly reading or uploading a previous account's
 * local data after an unclean sign-out or a direct account switch.
 */
export async function getLocalOwnerIds(
  db: AbstractPowerSyncDatabase,
): Promise<string[]> {
  const rows = await db.getAll<{ user_id: string }>(
    `SELECT user_id
       FROM (
         SELECT user_id FROM projects WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM sources WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM card_reviews WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM review_logs WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM cram_plans WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM cram_review_logs WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM user_study_settings WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM user_fsrs_params WHERE user_id IS NOT NULL
         UNION
         SELECT user_id FROM user_profiles WHERE user_id IS NOT NULL
       )
      LIMIT 2`,
  );

  return rows.map((row) => row.user_id);
}
