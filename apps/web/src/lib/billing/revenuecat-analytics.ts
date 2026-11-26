import type { PlanKey } from "@/lib/billing/plans";
import {
  normalizeRevenueCatUserId,
  type RevenueCatWebhookEvent,
} from "@/lib/billing/revenuecat-webhook";

export type RevenueCatAnalyticsEvent = {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
};

/**
 * RevenueCat webhook types → PostHog event names. One event per lifecycle
 * step lets funnels and revenue analytics use plain event filters instead of
 * a property filter on a catch-all event.
 */
const EVENT_NAMES: Record<string, string> = {
  INITIAL_PURCHASE: "subscription_started",
  RENEWAL: "subscription_renewed",
  CANCELLATION: "subscription_cancelled",
  UNCANCELLATION: "subscription_reactivated",
  EXPIRATION: "subscription_expired",
  PRODUCT_CHANGE: "subscription_plan_changed",
  BILLING_ISSUE: "subscription_billing_issue",
  NON_RENEWING_PURCHASE: "purchase_completed",
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Types that carry money. Others repeat a price without a charge behind it. A
 * CANCELLATION counts only as a refund, which RevenueCat prices negatively.
 */
const CHARGE_TYPES = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"]);

function revenueOf(type: string, price: number | null): number | null {
  if (price === null) return null;
  if (CHARGE_TYPES.has(type) && price > 0) return price;
  return type === "CANCELLATION" && price < 0 ? price : null;
}

/**
 * Builds the PostHog event for a RevenueCat webhook, or null when there is no
 * user to attribute it to. Revenue is RevenueCat's USD `price` (negative for
 * refunds), sent as `$revenue` so PostHog revenue analytics can sum it.
 * `plan` is the account's plan after reconciliation, not a guess from one
 * event: a Plus expiry can arrive while Pro is active.
 */
export function revenueCatAnalyticsEvent(
  event: RevenueCatWebhookEvent,
  plan: PlanKey | null,
): RevenueCatAnalyticsEvent | null {
  if (!event.app_user_id) return null;
  const distinctId = normalizeRevenueCatUserId(event.app_user_id) ?? event.app_user_id;
  const isTrial = event.period_type?.toUpperCase() === "TRIAL";
  const name =
    event.type === "INITIAL_PURCHASE" && isTrial
      ? "trial_started"
      : (EVENT_NAMES[event.type] ?? "subscription_updated");

  const raw = event as Record<string, unknown>;
  const revenue = revenueOf(event.type, finiteNumber(raw.price));

  const properties: Record<string, unknown> = {
    revenuecat_event_type: event.type,
    product_id: event.product_id ?? null,
    store: event.store?.toLowerCase() ?? null,
    period_type: event.period_type ?? null,
    environment: event.environment,
    plan,
    currency: typeof raw.currency === "string" ? raw.currency : null,
    price_in_purchased_currency: finiteNumber(raw.price_in_purchased_currency),
    trial_conversion: raw.is_trial_conversion === true,
    cancel_reason: typeof raw.cancel_reason === "string" ? raw.cancel_reason : null,
    ...(plan ? { $set: { plan, is_paid: plan !== "basic" } } : {}),
  };
  if (revenue !== null) {
    properties.$revenue = revenue;
    properties.revenue_currency = "USD";
  }
  return { distinctId, event: name, properties };
}
