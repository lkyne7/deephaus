import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import {
  getBillingPlan,
  type BillingFeatureGates,
  type PlanKey,
} from "@/lib/billing/plans";

export type BillingAccountStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "grace_period"
  | "billing_issue"
  | "expired";

export type BillingEnvironment = "sandbox" | "production";

export type BillingCreditsStatus = {
  periodStart: string;
  periodEnd: string;
  allowance: number;
  used: number;
  reserved: number;
  remaining: number;
};

export type BillingStatus = {
  plan: PlanKey;
  planName: string;
  status: BillingAccountStatus;
  isActive: boolean;
  priority: 0 | 1;
  source: string | null;
  productId: string | null;
  entitlementIds: string[];
  expiresAt: string | null;
  willRenew: boolean;
  environment: BillingEnvironment;
  credits: BillingCreditsStatus;
  features: BillingFeatureGates;
};

type BillingAccountRow = {
  plan: unknown;
  status: unknown;
  source?: unknown;
  product_id?: unknown;
  entitlement_ids?: unknown;
  expires_at?: unknown;
  will_renew?: unknown;
  environment?: unknown;
};

type CreditPeriodRow = {
  allowance?: unknown;
  used?: unknown;
  reserved?: unknown;
};

const ACCESS_STATUSES = new Set<BillingAccountStatus>([
  "trialing",
  "active",
  "grace_period",
  "billing_issue",
]);

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function accountStatus(value: unknown): BillingAccountStatus {
  switch (value) {
    case "trialing":
    case "active":
    case "grace_period":
    case "billing_issue":
    case "expired":
      return value;
    default:
      return "inactive";
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function currentCalendarMonth(now = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  };
}

export function normalizeBillingStatus(
  account: BillingAccountRow | null,
  period: CreditPeriodRow | null,
  now = new Date(),
): BillingStatus {
  const storedStatus = accountStatus(account?.status);
  const expiresAt = stringOrNull(account?.expires_at);
  const expirationTime = expiresAt === null ? null : Date.parse(expiresAt);
  const hasExpired =
    storedStatus === "expired" ||
    (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime <= now.getTime()));
  const isActive = Boolean(account) && !hasExpired && ACCESS_STATUSES.has(storedStatus);
  const plan = getBillingPlan(isActive ? account?.plan : "basic");
  const used = nonNegativeInteger(period?.used);
  const reserved = nonNegativeInteger(period?.reserved);
  // The database may temporarily pin its internal allowance to already-consumed
  // credits so a downgrade does not violate its constraint. The user-facing
  // limit remains the effective plan's allowance; remaining credits stay zero
  // when historical usage is above that limit.
  const allowance = plan.monthlyCredits;
  const { periodStart, periodEnd } = currentCalendarMonth(now);

  return {
    plan: plan.key,
    planName: plan.name,
    status: hasExpired ? "expired" : storedStatus,
    isActive,
    priority: plan.priority,
    source: stringOrNull(account?.source),
    productId: stringOrNull(account?.product_id),
    entitlementIds:
      isActive && Array.isArray(account?.entitlement_ids)
        ? account.entitlement_ids.filter((id): id is string => typeof id === "string")
        : [],
    expiresAt,
    willRenew: isActive && account?.will_renew === true,
    environment: account?.environment === "sandbox" ? "sandbox" : "production",
    credits: {
      periodStart,
      periodEnd,
      allowance,
      used,
      reserved,
      remaining: Math.max(0, allowance - used - reserved),
    },
    features: { ...plan.features },
  };
}

export async function loadBillingStatus(
  userId: string,
  now = new Date(),
): Promise<BillingStatus> {
  const service = createServiceClient();
  const { periodStart } = currentCalendarMonth(now);

  const [accountResult, periodResult] = await Promise.all([
    service
      .from("billing_accounts")
      .select(
        "plan,status,source,product_id,entitlement_ids,expires_at,will_renew,environment",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("ai_credit_periods")
      .select("allowance,used,reserved")
      .eq("user_id", userId)
      .eq("period_start", periodStart)
      .maybeSingle(),
  ]);

  if (accountResult.error) {
    throw new Error(`Failed to load billing account: ${accountResult.error.message}`);
  }
  if (periodResult.error) {
    throw new Error(`Failed to load billing credits: ${periodResult.error.message}`);
  }

  return normalizeBillingStatus(
    (accountResult.data as BillingAccountRow | null) ?? null,
    (periodResult.data as CreditPeriodRow | null) ?? null,
    now,
  );
}
