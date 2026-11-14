import { removeStorageTree } from "@deephaus/shared";
import { createServiceClient } from "@/lib/supabase/server";
const BUCKETS = ["avatars", "card-media", "pdfs", "apkg-imports"];
type Service = ReturnType<typeof createServiceClient>;
type DeletionResult = { processed: boolean; complete?: boolean };

/** Claims the oldest waiting deletion; the background worker's retry loop. */
export async function processAccountDeletions(): Promise<DeletionResult> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("claim_account_deletion");
  if (error) throw error;
  const job = data?.[0] as { user_id: string } | undefined;
  if (!job) return { processed: false };
  return runDeletion(service, job.user_id);
}

/**
 * Deletes one account right after it is requested, so the email is free to
 * sign up again at once instead of whenever the worker next polls. A failure
 * leaves the request pending for the worker to retry.
 */
export async function processAccountDeletionFor(userId: string): Promise<DeletionResult> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("account_deletion_requests")
    .update({ status: "processing", lease_until: new Date(Date.now() + 120_000).toISOString() })
    .eq("user_id", userId)
    .neq("status", "complete")
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select("user_id");
  if (error) throw error;
  // Already complete, or the worker holds the lease.
  if (!data?.length) return { processed: false };
  return runDeletion(service, userId);
}

async function runDeletion(service: Service, userId: string): Promise<DeletionResult> {
  try {
    const deadline = Date.now() + 45_000;
    for (const bucket of BUCKETS)
      await removeStorageTree(
        service.storage.from(bucket),
        userId,
        deadline,
      );
    const { error: deletionError } = await service.auth.admin.deleteUser(userId);
    if (deletionError && deletionError.status !== 404) throw deletionError;
    const finished = await service
      .from("account_deletion_requests")
      .update({ status: "complete", last_error: null, lease_until: null })
      .eq("user_id", userId);
    if (finished.error) throw finished.error;
    return { processed: true, complete: true };
  } catch {
    // Retain a durable retry record. Do not expose provider details or file names.
    await service
      .from("account_deletion_requests")
      .update({
        status: "pending",
        last_error: "Cleanup needs another attempt",
        lease_until: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("user_id", userId);
    return { processed: true, complete: false };
  }
}
