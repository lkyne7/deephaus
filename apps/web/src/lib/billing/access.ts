import "server-only";
import { NextResponse } from "next/server";
import type { PlanKey } from "@/lib/billing/plans";
import { createServiceClient } from "@/lib/supabase/server";

export type SubscriptionPlan = PlanKey;

const PLAN_RANK: Record<SubscriptionPlan, number> = {
  basic: 0,
  plus: 1,
  pro: 2,
};

const PLAN_UPLOAD_BYTES: Record<SubscriptionPlan, number> = {
  basic: 25 * 1024 * 1024,
  plus: 50 * 1024 * 1024,
  pro: 100 * 1024 * 1024,
};

function isActiveStatus(status: unknown): boolean {
  return (
    status === "trialing" ||
    status === "active" ||
    status === "grace_period" ||
    status === "billing_issue"
  );
}

export async function getEffectivePlan(userId: string): Promise<SubscriptionPlan> {
  const service = createServiceClient();
  const { data } = await service
    .from("billing_accounts")
    .select("plan, status, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || !isActiveStatus(data.status)) return "basic";
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return "basic";
  }
  return data.plan === "pro" || data.plan === "plus" ? data.plan : "basic";
}

export function planIncludes(
  current: SubscriptionPlan,
  minimum: SubscriptionPlan,
): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[minimum];
}

export async function requirePlan(
  userId: string,
  minimum: Exclude<SubscriptionPlan, "basic">,
  feature: string,
): Promise<NextResponse | null> {
  const current = await getEffectivePlan(userId);
  if (planIncludes(current, minimum)) return null;
  return NextResponse.json(
    {
      error: `${feature} requires the ${minimum === "pro" ? "Pro" : "Plus"} plan.`,
      code: "PLAN_UPGRADE_REQUIRED",
      currentPlan: current,
      requiredPlan: minimum,
      feature,
    },
    { status: 402 },
  );
}

export function getPlanUploadLimit(plan: SubscriptionPlan): number {
  return PLAN_UPLOAD_BYTES[plan];
}
