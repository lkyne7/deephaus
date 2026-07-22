import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  BillingAccountStatus,
  BillingEnvironment,
} from "@/lib/billing/server";
import type { PlanKey } from "@/lib/billing/plans";

const revenueCatEventSchema = z
  .object({
    id: z.string().min(1).max(512),
    type: z.string().min(1).max(128),
    app_user_id: z.string().min(1).max(512).nullable().optional(),
    event_timestamp_ms: z.number().int().nonnegative(),
    environment: z
      .enum(["SANDBOX", "PRODUCTION", "sandbox", "production"])
      .default("PRODUCTION")
      .transform(
        (value): BillingEnvironment =>
          value.toLowerCase() as BillingEnvironment,
      ),
    entitlement_id: z.string().nullable().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    transferred_from: z.array(z.string()).nullable().optional(),
    transferred_to: z.array(z.string()).nullable().optional(),
    product_id: z.string().nullable().optional(),
    expiration_at_ms: z.number().int().nonnegative().nullable().optional(),
    grace_period_expiration_at_ms: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    period_type: z.string().nullable().optional(),
    store: z.string().nullable().optional(),
  })
  .passthrough();

const revenueCatWebhookSchema = z
  .object({ event: revenueCatEventSchema })
  .passthrough();

const subscriberEntitlementSchema = z
  .object({
    expires_date: z.string().nullable().optional(),
    grace_period_expires_date: z.string().nullable().optional(),
    product_identifier: z.string().nullable().optional(),
    purchase_date: z.string().nullable().optional(),
  })
  .passthrough();

const subscriberSubscriptionSchema = z
  .object({
    expires_date: z.string().nullable().optional(),
    grace_period_expires_date: z.string().nullable().optional(),
    unsubscribe_detected_at: z.string().nullable().optional(),
    billing_issues_detected_at: z.string().nullable().optional(),
    period_type: z.string().nullable().optional(),
    store: z.string().nullable().optional(),
  })
  .passthrough();

const revenueCatSubscriberSchema = z
  .object({
    request_date_ms: z.number().int().nonnegative().optional(),
    subscriber: z
      .object({
        entitlements: z.record(subscriberEntitlementSchema).default({}),
        subscriptions: z.record(subscriberSubscriptionSchema).default({}),
      })
      .passthrough(),
  })
  .passthrough();

export type RevenueCatWebhookEvent = z.infer<typeof revenueCatEventSchema>;
export type RevenueCatSubscriber = z.infer<
  typeof revenueCatSubscriberSchema
>["subscriber"];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DatabaseError = { code?: string | null; message?: string | null };

type BillingAccountUpdate = {
  user_id: string;
  plan: PlanKey;
  status: BillingAccountStatus;
  source: string;
  product_id: string | null;
  entitlement_ids: string[];
  expires_at: string | null;
  will_renew: boolean;
  environment: BillingEnvironment;
  event_timestamp_ms: number;
  updated_at: string;
};

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equalSecret(candidate: string, expected: string): boolean {
  return timingSafeEqual(secretDigest(candidate), secretDigest(expected));
}

export function isRevenueCatWebhookAuthorized(
  authorization: string | null,
  secret = process.env.REVENUECAT_WEBHOOK_SECRET,
): boolean {
  if (!authorization || !secret) return false;
  return (
    equalSecret(authorization, secret) ||
    equalSecret(authorization, `Bearer ${secret}`)
  );
}

export function parseRevenueCatWebhookBody(body: unknown) {
  return revenueCatWebhookSchema.safeParse(body);
}

export function normalizeRevenueCatUserId(appUserId: string): string | null {
  const normalized = appUserId.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function acceptsEnvironment(environment: BillingEnvironment): boolean {
  return (
    environment === "production" ||
    process.env.NODE_ENV !== "production" ||
    process.env.REVENUECAT_ALLOW_SANDBOX_ENTITLEMENTS === "true"
  );
}

function entitlementIds(event: RevenueCatWebhookEvent): string[] {
  return Array.from(
    new Set(
      [...(event.entitlement_ids ?? []), event.entitlement_id].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  );
}

export function planFromEntitlements(ids: readonly string[]): PlanKey {
  const normalized = new Set(ids.map((id) => id.trim().toLowerCase()));
  if (normalized.has("pro")) return "pro";
  if (normalized.has("plus")) return "plus";
  return "basic";
}

function expirationIso(event: RevenueCatWebhookEvent): string | null {
  const timestamp =
    event.type === "BILLING_ISSUE"
      ? (event.grace_period_expiration_at_ms ?? event.expiration_at_ms)
      : event.expiration_at_ms;
  if (timestamp == null) return null;
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function billingUpdateFromRevenueCatEvent(
  event: RevenueCatWebhookEvent,
  userId: string,
): BillingAccountUpdate {
  const eventEntitlements = entitlementIds(event);
  const expiredEvent = event.type === "EXPIRATION";
  const activeEntitlements = expiredEvent ? [] : eventEntitlements;
  const plan = planFromEntitlements(activeEntitlements);
  const expiration = expirationIso(event);
  const expirationPassed =
    expiration !== null && Date.parse(expiration) <= event.event_timestamp_ms;

  let status: BillingAccountStatus;
  if (expiredEvent) status = "expired";
  else if (event.type === "BILLING_ISSUE") status = "billing_issue";
  else if (expirationPassed) status = "expired";
  else if (plan === "basic") status = "inactive";
  else if (event.period_type?.toUpperCase() === "TRIAL") status = "trialing";
  else status = "active";

  return {
    user_id: userId,
    plan: status === "expired" ? "basic" : plan,
    status,
    source: event.store?.toLowerCase() || "revenuecat",
    product_id: event.product_id ?? null,
    entitlement_ids: activeEntitlements,
    expires_at: expiration,
    will_renew:
      status !== "expired" &&
      plan !== "basic" &&
      event.type !== "CANCELLATION" &&
      event.type !== "TEMPORARY_ENTITLEMENT_GRANT",
    environment: event.environment,
    event_timestamp_ms: event.event_timestamp_ms,
    updated_at: new Date(event.event_timestamp_ms).toISOString(),
  };
}

type SubscriberLookup =
  | { kind: "found"; subscriber: RevenueCatSubscriber }
  | { kind: "missing" }
  | { kind: "unavailable" };

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function laterDate(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime === null) return rightTime === null ? null : right!;
  if (rightTime === null) return left!;
  return leftTime >= rightTime ? left! : right!;
}

export async function fetchRevenueCatSubscriber(
  appUserId: string,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SubscriberLookup> {
  const apiKey =
    options.apiKey ?? process.env.REVENUECAT_SECRET_API_KEY?.trim();
  if (!apiKey) return { kind: "unavailable" };

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      },
    );
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = revenueCatSubscriberSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: "found", subscriber: parsed.data.subscriber }
      : { kind: "unavailable" };
  } catch {
    // Webhooks must not enter RevenueCat retry loops because reconciliation is
    // temporarily unavailable. The event is recorded as ignored and a later
    // event can reconcile the current subscriber snapshot.
    return { kind: "unavailable" };
  }
}

export function billingUpdateFromRevenueCatSubscriber(
  subscriber: RevenueCatSubscriber,
  event: RevenueCatWebhookEvent,
  userId: string,
  nowMs = Date.now(),
): BillingAccountUpdate {
  const activeEntries = Object.entries(subscriber.entitlements).filter(
    ([, entitlement]) => {
      const expiration = laterDate(
        entitlement.expires_date,
        entitlement.grace_period_expires_date,
      );
      return expiration === null || Date.parse(expiration) > nowMs;
    },
  );
  const activeIds = activeEntries.map(([id]) => id);
  const plan = planFromEntitlements(activeIds);
  const planEntry =
    activeEntries.find(([id]) => id.trim().toLowerCase() === plan) ?? null;
  const productId = planEntry?.[1].product_identifier ?? null;
  const subscription = productId
    ? subscriber.subscriptions[productId]
    : undefined;
  const expiration = laterDate(
    planEntry?.[1].expires_date,
    planEntry?.[1].grace_period_expires_date,
  );

  let status: BillingAccountStatus;
  if (plan === "basic") {
    status = Object.keys(subscriber.entitlements).some((id) =>
      ["plus", "pro"].includes(id.trim().toLowerCase()),
    )
      ? "expired"
      : "inactive";
  } else if (
    subscription?.billing_issues_detected_at &&
    timestamp(subscription.grace_period_expires_date) !== null &&
    timestamp(subscription.grace_period_expires_date)! > nowMs
  ) {
    status = "billing_issue";
  } else if (subscription?.period_type?.toUpperCase() === "TRIAL") {
    status = "trialing";
  } else {
    status = "active";
  }

  return {
    user_id: userId,
    plan,
    status,
    source: subscription?.store?.toLowerCase() || "revenuecat",
    product_id: productId,
    entitlement_ids: activeIds,
    expires_at: expiration,
    will_renew:
      plan !== "basic" && !subscription?.unsubscribe_detected_at,
    environment: event.environment,
    event_timestamp_ms: event.event_timestamp_ms,
    updated_at: new Date(event.event_timestamp_ms).toISOString(),
  };
}

async function billingEventExists(
  service: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("billing_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Failed to check billing event: ${error.message}`);
  return data !== null;
}

async function loadAccountTimestamp(
  service: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data, error } = await service
    .from("billing_accounts")
    .select("event_timestamp_ms")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load billing account: ${error.message}`);
  const timestamp = (data as { event_timestamp_ms?: unknown } | null)
    ?.event_timestamp_ms;
  return typeof timestamp === "number" ? timestamp : null;
}

async function updateExistingAccount(
  service: SupabaseClient,
  update: BillingAccountUpdate,
): Promise<void> {
  const { user_id: userId, ...fields } = update;
  const { error } = await service
    .from("billing_accounts")
    .update(fields)
    .eq("user_id", userId)
    .lt("event_timestamp_ms", update.event_timestamp_ms);
  if (error) {
    throw new Error(`Failed to update billing account: ${error.message}`);
  }
}

async function applyAccountUpdate(
  service: SupabaseClient,
  update: BillingAccountUpdate,
): Promise<"applied" | "stale" | "missing"> {
  const storedTimestamp = await loadAccountTimestamp(service, update.user_id);
  if (storedTimestamp !== null) {
    if (storedTimestamp >= update.event_timestamp_ms) return "stale";
    await updateExistingAccount(service, update);
    return "applied";
  }

  const { error } = await service.from("billing_accounts").insert(update);
  if (!error) return "applied";
  if ((error as DatabaseError).code === "23503") return "missing";
  if ((error as DatabaseError).code !== "23505") {
    throw new Error(`Failed to create billing account: ${error.message}`);
  }

  const concurrentTimestamp = await loadAccountTimestamp(
    service,
    update.user_id,
  );
  if (
    concurrentTimestamp !== null &&
    concurrentTimestamp >= update.event_timestamp_ms
  ) {
    return "stale";
  }
  await updateExistingAccount(service, update);
  return "applied";
}

async function recordBillingEvent(
  service: SupabaseClient,
  event: RevenueCatWebhookEvent,
  userId: string | null,
): Promise<boolean> {
  const { error } = await service.from("billing_events").insert({
    event_id: event.id,
    user_id: userId,
    event_type: event.type,
    event_timestamp_ms: event.event_timestamp_ms,
    environment: event.environment,
  });
  if (!error) return true;
  if ((error as DatabaseError).code === "23505") return false;
  if ((error as DatabaseError).code === "23503" && userId !== null) {
    return recordBillingEvent(service, event, null);
  }
  throw new Error(`Failed to record billing event: ${error.message}`);
}

export async function processRevenueCatWebhookEvent(
  service: SupabaseClient,
  event: RevenueCatWebhookEvent,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ duplicate: boolean; stale: boolean; ignored: boolean }> {
  if (await billingEventExists(service, event.id)) {
    return { duplicate: true, stale: false, ignored: false };
  }

  const candidateIds = Array.from(
    new Set(
      [
        event.app_user_id,
        ...(event.transferred_from ?? []),
        ...(event.transferred_to ?? []),
      ].flatMap((value) => {
        if (typeof value !== "string") return [];
        const normalized = normalizeRevenueCatUserId(value);
        return normalized ? [normalized] : [];
      }),
    ),
  );

  let stale = false;
  let ignored = !acceptsEnvironment(event.environment) || candidateIds.length === 0;
  const reconciledUsers: string[] = [];

  if (!ignored) {
    for (const userId of candidateIds) {
      const lookup = await fetchRevenueCatSubscriber(userId, options);
      if (lookup.kind !== "found") {
        ignored = true;
        continue;
      }
      const result = await applyAccountUpdate(
        service,
        billingUpdateFromRevenueCatSubscriber(
          lookup.subscriber,
          event,
          userId,
        ),
      );
      if (result === "missing") {
        ignored = true;
      } else {
        reconciledUsers.push(userId);
        stale ||= result === "stale";
      }
    }
  }

  // TRANSFER events can affect multiple accounts, while unknown/deleted users
  // cannot satisfy billing_events.user_id's FK. Keep the audit event and use a
  // nullable user_id for those cases.
  const eventUserId =
    event.type !== "TRANSFER" && reconciledUsers.length === 1
      ? reconciledUsers[0]!
      : null;
  const inserted = await recordBillingEvent(service, event, eventUserId);
  return { duplicate: !inserted, stale, ignored };
}
