import { removeStorageTree } from "@deephaus/shared";
import { createServiceClient } from "@/lib/supabase/server";
const BUCKETS = ["avatars", "card-media", "pdfs", "apkg-imports"];
export async function processAccountDeletions() {
  const service = createServiceClient();
  const { data, error } = await service.rpc("claim_account_deletion");
  if (error) throw error;
  const job = data?.[0] as { user_id: string } | undefined;
  if (!job) return { processed: false };
  try {
    const deadline = Date.now() + 45_000;
    for (const bucket of BUCKETS)
      await removeStorageTree(
        service.storage.from(bucket),
        job.user_id,
        deadline,
      );
    const { error: deletionError } = await service.auth.admin.deleteUser(
      job.user_id,
    );
    if (deletionError && deletionError.status !== 404) throw deletionError;
    const finished = await service
      .from("account_deletion_requests")
      .update({ status: "complete", last_error: null, lease_until: null })
      .eq("user_id", job.user_id);
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
      .eq("user_id", job.user_id);
    return { processed: true, complete: false };
  }
}
