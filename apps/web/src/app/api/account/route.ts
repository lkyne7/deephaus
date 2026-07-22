import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Buckets that store per-user files under a `{userId}/…` prefix. */
const USER_STORAGE_BUCKETS = ["avatars", "card-media", "pdfs", "apkg-imports"];
const MAX_CLEANUP_FILES = 5000;

/**
 * Best-effort recursive removal of a user's storage folder. Database rows are
 * removed by `on delete cascade`, but storage objects are not, so orphaned
 * files would linger (and keep serving from public buckets) after deletion.
 */
async function removeUserFolder(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  userId: string,
) {
  const paths: string[] = [];
  const queue = [userId];

  while (queue.length > 0 && paths.length < MAX_CLEANUP_FILES) {
    const prefix = queue.shift()!;
    const { data: entries, error } = await service.storage
      .from(bucket)
      .list(prefix, { limit: 1000 });
    if (error || !entries) break;
    for (const entry of entries) {
      // Folders come back without an id; files have one.
      if (entry.id) paths.push(`${prefix}/${entry.name}`);
      else queue.push(`${prefix}/${entry.name}`);
    }
  }

  for (let i = 0; i < paths.length; i += 100) {
    await service.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const service = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as {
    acknowledge_subscription_cancellation?: unknown;
  };
  const { data: billing } = await service
    .from("billing_accounts")
    .select("status, will_renew, expires_at")
    .eq("user_id", user!.id)
    .maybeSingle();
  const paidAccessActive =
    billing &&
    ["trialing", "active", "grace_period", "billing_issue"].includes(billing.status) &&
    (!billing.expires_at || new Date(billing.expires_at).getTime() > Date.now());

  if (
    paidAccessActive &&
    billing.will_renew &&
    body.acknowledge_subscription_cancellation !== true
  ) {
    return NextResponse.json(
      {
        error:
          "Deleting DeepHaus does not cancel an App Store, Google Play, or Stripe subscription. Cancel it in the store or billing portal first, or confirm that you understand it may keep renewing.",
        code: "ACTIVE_SUBSCRIPTION_RENEWS",
      },
      { status: 409 },
    );
  }

  await Promise.all(
    USER_STORAGE_BUCKETS.map((bucket) =>
      removeUserFolder(service, bucket, user!.id).catch((error) => {
        console.warn(`Account cleanup for bucket ${bucket} failed:`, error);
      }),
    ),
  );

  const { error } = await service.auth.admin.deleteUser(user!.id);
  if (error) {
    console.error("Account deletion failed:", error.message);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
