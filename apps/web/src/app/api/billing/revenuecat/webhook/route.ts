import { NextResponse } from "next/server";
import {
  isRevenueCatWebhookAuthorized,
  normalizeRevenueCatUserId,
  parseRevenueCatWebhookBody,
  processRevenueCatWebhookEvent,
  RevenueCatReconciliationUnavailable,
  type RevenueCatWebhookEvent,
} from "@/lib/billing/revenuecat-webhook";
import { isPlanKey } from "@/lib/billing/plans";
import { revenueCatAnalyticsEvent } from "@/lib/billing/revenuecat-analytics";
import { getPostHogServer } from "@/lib/posthog-server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Never throws: an analytics failure must not make RevenueCat retry billing. */
async function captureSubscriptionEvent(
  service: ReturnType<typeof createServiceClient>,
  event: RevenueCatWebhookEvent,
): Promise<void> {
  try {
    const posthog = getPostHogServer();
    const userId = event.app_user_id ? normalizeRevenueCatUserId(event.app_user_id) : null;
    if (!posthog || !userId) return;
    const { data } = await service
      .from("billing_accounts")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();
    const plan = isPlanKey(data?.plan) ? data.plan : null;
    const analytics = revenueCatAnalyticsEvent(event, plan);
    if (!analytics) return;
    posthog.capture(analytics);
    await posthog.flush();
  } catch (error) {
    console.warn("Subscription analytics failed:", error);
  }
}

export async function POST(request: Request) {
  if (!isRevenueCatWebhookAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseRevenueCatWebhookBody(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid RevenueCat event" },
      { status: 400 },
    );
  }

  try {
    const service = createServiceClient();
    const event = parsed.data.event;
    const result = await processRevenueCatWebhookEvent(service, event);

    // Subscription lifecycle changes only ever arrive server-side. Retries are
    // skipped so revenue counts once; ignored events (sandbox, unknown users)
    // never reach product analytics.
    if (!result.duplicate && !result.ignored) {
      await captureSubscriptionEvent(service, event);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("RevenueCat webhook processing failed:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: error instanceof RevenueCatReconciliationUnavailable ? 503 : 500 },
    );
  }
}
