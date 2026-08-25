import { NextResponse } from "next/server";
import {
  isRevenueCatWebhookAuthorized,
  parseRevenueCatWebhookBody,
  processRevenueCatWebhookEvent,
} from "@/lib/billing/revenuecat-webhook";
import { getPostHogServer } from "@/lib/posthog-server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
    const result = await processRevenueCatWebhookEvent(
      createServiceClient(),
      parsed.data.event,
    );

    // Subscription lifecycle changes only ever arrive server-side.
    const event = parsed.data.event;
    const posthog = getPostHogServer();
    if (posthog && event.app_user_id) {
      posthog.capture({
        distinctId: event.app_user_id,
        event: "subscription_updated",
        properties: {
          revenuecat_event_type: event.type,
          period_type: event.period_type ?? null,
        },
      });
      await posthog.flush().catch(() => undefined);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("RevenueCat webhook processing failed:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
