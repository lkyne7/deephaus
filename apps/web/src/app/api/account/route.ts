import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const service = createServiceClient();
  const body = (await request.json().catch(() => ({}))) as {
    acknowledge_subscription_cancellation?: unknown;
  };
  const { data: billing, error: billingError } = await service
    .from("billing_accounts")
    .select("status, will_renew, expires_at")
    .eq("user_id", user!.id)
    .maybeSingle();
  if (billingError) return NextResponse.json({ error: "Could not verify subscription status. Please retry." }, { status: 503 });
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

  const queued = await service.from("account_deletion_requests").upsert(
    { user_id: user!.id }, { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (queued.error) return NextResponse.json({ error: "Could not start deletion. Please retry." }, { status: 503 });
  // The database now blocks new writes, including uploads from other devices.
  return NextResponse.json({ ok: true, status: "pending", message: "Your account deletion is queued. File cleanup will continue automatically." }, { status: 202 });
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const { data, error } = await createServiceClient().from("account_deletion_requests").select("status, requested_at").eq("user_id", user!.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read deletion status" }, { status: 503 });
  return NextResponse.json(data ?? { status: "none" });
}
