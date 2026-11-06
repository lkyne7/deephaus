"use client";

import type { Package } from "@revenuecat/purchases-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isRevenueCatCancellation,
  revenueCatErrorMessage,
  useRevenueCatWeb,
} from "@/lib/billing/revenuecat-web";
import type { BillingStatus } from "@/lib/billing/server";
import { OfflineNotice } from "@/components/offline-gate";
import { SettingsLoadingState } from "@/components/settings/settings-shell";
import { useOnline } from "@/lib/offline/use-online";

type Plan = "basic" | "plus" | "pro";
type BillingState = {
  plan: Plan;
  status: string;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
  credits: {
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
    periodEnd: string | null;
  };
};

type PackageChoice = {
  plan: Exclude<Plan, "basic">;
  cadence: "monthly" | "annual";
  rcPackage: Package;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "grace_period"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  }
  return null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function normalizeBillingStatus(value: BillingStatus): BillingState {
  const body = asRecord(value);
  const creditSource = asRecord(
    body.credits ?? body.aiCredits ?? body.creditUsage ?? body.currentPeriod,
  );
  const planValue = readString(body, "plan");
  const plan: Plan =
    planValue === "plus" || planValue === "pro" || planValue === "basic" ? planValue : "basic";
  const defaultAllowance = plan === "pro" ? 8000 : plan === "plus" ? 3000 : 250;
  const allowance =
    readNumber(creditSource, "allowance", "limit", "total") ??
    readNumber(body, "creditAllowance", "credit_limit") ??
    defaultAllowance;
  const used =
    readNumber(creditSource, "used", "consumed") ?? readNumber(body, "creditsUsed") ?? 0;
  const reserved =
    readNumber(creditSource, "reserved", "pending") ?? readNumber(body, "creditsReserved") ?? 0;
  const remaining =
    readNumber(creditSource, "remaining", "available") ??
    readNumber(body, "creditsRemaining") ??
    Math.max(0, allowance - used - reserved);

  return {
    plan,
    status: readString(body, "status") ?? "inactive",
    productId: readString(body, "productId", "product_id"),
    expiresAt: readString(body, "expiresAt", "expires_at"),
    willRenew: body.willRenew === true || body.will_renew === true,
    credits: {
      allowance,
      used,
      reserved,
      remaining,
      periodEnd: readString(creditSource, "periodEnd", "period_end", "resetsAt", "resets_at"),
    },
  };
}

async function fetchBillingStatus(): Promise<BillingState> {
  const response = await fetch("/api/billing/status", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Could not load billing status");
  }
  return normalizeBillingStatus((await response.json()) as BillingStatus);
}

function planLabel(plan: Plan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function identifierContainsToken(identifier: string, token: string): boolean {
  return new RegExp(`(^|[\\s._-])${token}([\\s._-]|$)`, "i").test(identifier);
}

function packageCadence(rcPackage: Package): "monthly" | "annual" | null {
  // The checkout product's billing period is authoritative. A custom package
  // named `plus_monthly` can still be misconfigured to sell an annual product.
  const period = rcPackage.webBillingProduct.period;
  if (period?.unit === "month" && period.number === 1) return "monthly";
  if (period?.unit === "year" && period.number === 1) return "annual";
  if (rcPackage.packageType === "$rc_monthly") return "monthly";
  if (rcPackage.packageType === "$rc_annual") return "annual";
  return null;
}

function packagePlan(rcPackage: Package, offeringIdentifier: string): "plus" | "pro" | null {
  // Match plan tokens with separators so Stripe product ids like `prod_…`
  // are not treated as Pro via a naive substring check.
  const candidates = [
    rcPackage.identifier,
    rcPackage.webBillingProduct.title,
    offeringIdentifier,
    // Stripe ids are `prod_…`; only use them when they also contain a real plan token.
    rcPackage.webBillingProduct.identifier,
  ];
  if (candidates.some((value) => identifierContainsToken(value, "pro"))) return "pro";
  if (candidates.some((value) => identifierContainsToken(value, "plus"))) return "plus";
  return null;
}

function formatDate(value: string | null, withYear = true): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
  });
}

function planSummary(billing: BillingState): string {
  const parts = [`${billing.credits.allowance.toLocaleString()} AI credits a month`];
  if (billing.plan === "basic" && billing.status === "inactive") parts.push("Free plan");
  else parts.push(statusLabel(billing.status));
  const date = formatDate(billing.expiresAt);
  if (date) parts.push(`${billing.willRenew ? "renews" : "access through"} ${date}`);
  else if (billing.plan === "basic") parts.push("no expiry");
  return parts.join(" · ");
}

function readDiscountCodeFromUrl(): string | null {
  const value = new URL(window.location.href).searchParams.get("discount_code")?.trim();
  return value || null;
}

function readCheckoutFlags(): { notice: string | null; cleanUrl: string | null } {
  const url = new URL(window.location.href);
  let notice: string | null = null;
  let changed = false;

  for (const key of ["billing", "billing_status", "purchase"]) {
    const value = url.searchParams.get(key)?.toLowerCase();
    if (value === "success") {
      notice = "Purchase completed. Your plan may take a moment to update.";
    } else if (value === "cancelled" || value === "canceled") {
      notice = "Checkout was cancelled. No changes were made.";
    } else {
      continue;
    }
    url.searchParams.delete(key);
    changed = true;
  }

  return { notice, cleanUrl: changed ? `${url.pathname}${url.search}${url.hash}` : null };
}

export function BillingSection({ email }: { email: string }) {
  const {
    configured,
    loading: revenueCatLoading,
    offerings,
    managementURL,
    error: revenueCatError,
    purchasePackage,
    refreshOfferings,
    restorePurchases,
  } = useRevenueCatWeb();
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState<string | null>(null);
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly");
  const online = useOnline();
  const router = useRouter();

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const next = await fetchBillingStatus();
      setBilling(next);
      return next;
    } catch (failure) {
      setStatusError(failure instanceof Error ? failure.message : "Could not load billing status");
      return null;
    }
  }, []);

  useEffect(() => {
    // The app shell remounts this page right after hydration, so the flags have
    // to stay in the URL until the router replaces it; both mounts read them.
    const { notice: checkoutNotice, cleanUrl } = readCheckoutFlags();
    if (checkoutNotice) setNotice(checkoutNotice);
    if (cleanUrl) router.replace(cleanUrl, { scroll: false });
    setDiscountCode(readDiscountCodeFromUrl());
    void loadStatus();
  }, [loadStatus, router]);

  const packageChoices = useMemo(() => {
    if (!offerings) return [] as PackageChoice[];
    const choices: PackageChoice[] = [];
    const seen = new Set<string>();

    for (const [offeringIdentifier, offering] of Object.entries(offerings.all)) {
      for (const rcPackage of offering.availablePackages) {
        const plan = packagePlan(rcPackage, offeringIdentifier);
        const cadence = packageCadence(rcPackage);
        // Dedupe by plan+cadence slot. Stripe product ids are often shared
        // across misconfigured monthly/annual packages, so product id alone
        // is not a reliable unique key.
        const key = `${plan}:${cadence}`;
        if (!plan || !cadence || seen.has(key)) continue;
        seen.add(key);
        choices.push({ plan, cadence, rcPackage });
      }
    }
    return choices;
  }, [offerings]);

  async function pollForWebhook(expectedPlan?: Plan, expectedProductId?: string) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const next = await fetchBillingStatus().catch(() => null);
      if (next) {
        setBilling(next);
        const active = ACTIVE_STATUSES.has(next.status);
        const matches =
          (!expectedPlan && !expectedProductId) ||
          next.plan === expectedPlan ||
          Boolean(expectedProductId && next.productId === expectedProductId);
        if (active && matches) return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return false;
  }

  async function handlePurchase(choice: PackageChoice) {
    setBusyPackageId(choice.rcPackage.webBillingProduct.identifier);
    setActionError(null);
    setNotice(null);
    try {
      await purchasePackage(choice.rcPackage, email, discountCode ?? undefined);
      setNotice("Purchase complete. Syncing your plan…");
      const synced = await pollForWebhook(
        choice.plan,
        choice.rcPackage.webBillingProduct.identifier,
      );
      setNotice(
        synced
          ? `${planLabel(choice.plan)} is now active.`
          : "Purchase complete. Your plan is still syncing; refresh in a moment.",
      );
    } catch (failure) {
      if (!isRevenueCatCancellation(failure)) setActionError(revenueCatErrorMessage(failure));
    } finally {
      setBusyPackageId(null);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    setActionError(null);
    setNotice(null);
    try {
      const customerInfo = await restorePurchases();
      if (!customerInfo) throw new Error("Could not refresh purchases.");
      const activeProductId = customerInfo.activeSubscriptions.values().next().value as
        | string
        | undefined;
      if (!activeProductId) {
        await loadStatus();
        setNotice("Purchases refreshed. No active subscription was found.");
        return;
      }
      const synced = await pollForWebhook(undefined, activeProductId);
      setNotice(
        synced
          ? "Purchases refreshed."
          : "Purchases refreshed in RevenueCat. Your account status is still syncing.",
      );
    } catch (failure) {
      setActionError(revenueCatErrorMessage(failure));
    } finally {
      setRestoring(false);
    }
  }

  function handlePlanAction(choice: PackageChoice) {
    const hasActiveSubscription =
      billing?.plan !== "basic" && ACTIVE_STATUSES.has(billing?.status ?? "");
    if (!hasActiveSubscription) {
      void handlePurchase(choice);
      return;
    }

    if (!managementURL) {
      setActionError(
        "Subscription management is temporarily unavailable. Please try again shortly.",
      );
      return;
    }

    window.open(managementURL, "_blank", "noopener,noreferrer");
  }

  if (!online && !billing) {
    return <OfflineNotice feature="Billing" />;
  }

  if (!billing && !statusError) {
    return <SettingsLoadingState label="Loading billing…" />;
  }

  const allowance = billing?.credits.allowance ?? 0;
  const used = billing?.credits.used ?? 0;
  const reserved = billing?.credits.reserved ?? 0;
  const usedPercent = allowance > 0 ? Math.min(100, (used / allowance) * 100) : 0;
  const reservedPercent =
    allowance > 0 ? Math.min(100 - usedPercent, (reserved / allowance) * 100) : 0;
  const hasActiveSubscription =
    billing?.plan !== "basic" && ACTIVE_STATUSES.has(billing?.status ?? "");

  return (
    <>
      {notice ? <div className="dhs-banner">{notice}</div> : null}
      {statusError ? (
        <div className="dhs-banner dhs-banner--error" role="alert">
          <span>{statusError}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadStatus()}>
            Retry
          </button>
        </div>
      ) : null}

      {billing ? (
        <>
          <section className="dhs-sec">
            <h2>Plan</h2>
            <div className="dh-surface dhs-plan">
              <div className="dhs-row__main">
                <div className="dhs-plan__name">{planLabel(billing.plan)}</div>
                <div className="dhs-muted">{planSummary(billing)}</div>
              </div>
              {managementURL ? (
                <a href={managementURL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                  Manage subscription
                </a>
              ) : null}
            </div>
            {hasActiveSubscription && !revenueCatLoading && !managementURL ? (
              <div className="dh-note dhs-note">
                <i className="ri-information-line" aria-hidden />
                <div>
                  <strong>Subscription management is unavailable</strong>
                  <p>Contact support to cancel or change your current subscription.</p>
                </div>
              </div>
            ) : null}
          </section>

          <section className="dhs-sec">
            <h2>AI credits</h2>
            <div className="dhs-meter-head">
              <span className="dhs-meter-head__strong">
                {used.toLocaleString()} of {allowance.toLocaleString()} used
              </span>
              {formatDate(billing.credits.periodEnd, false) ? (
                <span>Resets {formatDate(billing.credits.periodEnd, false)}</span>
              ) : null}
            </div>
            <div
              className="dh-meter dhs-credits"
              role="progressbar"
              aria-label="AI credits used or reserved"
              aria-valuemin={0}
              aria-valuemax={allowance}
              aria-valuenow={Math.min(allowance, used + reserved)}
            >
              <span style={{ width: `${usedPercent}%`, minWidth: used > 0 ? 6 : 0 }} />
              <span className="dhs-credits__reserved" style={{ width: `${reservedPercent}%` }} />
            </div>
            <p className="dhs-help">
              {reserved.toLocaleString()} reserved for running jobs ·{" "}
              {billing.credits.remaining.toLocaleString()} remaining
            </p>
          </section>
        </>
      ) : null}

      <section className="dhs-sec">
        <div className="dhs-sec-head">
          <h2>Plans</h2>
          {configured && !revenueCatLoading && packageChoices.length > 0 ? (
            <div className="dh-seg" role="group" aria-label="Billing period">
              {(["monthly", "annual"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={cadence === option}
                  onClick={() => setCadence(option)}
                >
                  {option === "monthly" ? "Monthly" : "Annual"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!configured ? (
          <div className="dh-note dhs-note">
            <i className="ri-information-line" aria-hidden />
            <div>
              <strong>Web purchases are not configured</strong>
              <p>
                Add <code>NEXT_PUBLIC_REVENUECAT_WEB_API_KEY</code> to enable checkout. Your current
                plan and credit usage are still available above.
              </p>
            </div>
          </div>
        ) : revenueCatLoading ? (
          <SettingsLoadingState label="Loading plan options…" />
        ) : packageChoices.length === 0 ? (
          <div className="dh-note dhs-note">
            <i className="ri-information-line" aria-hidden />
            <div>
              <strong>No web packages are available</strong>
              <p>
                Check the current RevenueCat offering and its Plus and Pro monthly or annual packages.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshOfferings()}>
                Refresh packages
              </button>
            </div>
          </div>
        ) : (
          <div className="dhs-plans">
            {(["plus", "pro"] as const).map((plan) => {
              const choice = packageChoices.find(
                (candidate) => candidate.plan === plan && candidate.cadence === cadence,
              );
              const productId = choice?.rcPackage.webBillingProduct.identifier;
              const busy = Boolean(productId && busyPackageId === productId);
              const currentPlan = hasActiveSubscription && billing?.plan === plan;
              const currentProduct = Boolean(
                productId && billing?.productId === productId && hasActiveSubscription,
              );
              return (
                <div key={plan} className="dh-surface dhs-plan-card">
                  <div className="dhs-plan-card__head">
                    <span>{planLabel(plan)}</span>
                    {currentPlan ? <span className="dh-pill dh-pill--accent">Current</span> : null}
                  </div>
                  <div className="dhs-muted">{plan === "plus" ? "3,000" : "8,000"} credits a month</div>
                  <div className="dhs-plan-card__price">
                    {choice?.rcPackage.webBillingProduct.price.formattedPrice ?? "Unavailable"}
                    {choice ? <small> / {cadence === "monthly" ? "month" : "year"}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!choice || Boolean(busyPackageId)}
                    onClick={() => choice && handlePlanAction(choice)}
                  >
                    {busy
                      ? "Opening…"
                      : currentProduct || currentPlan
                        ? "Manage"
                        : `Choose ${planLabel(plan)}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {revenueCatError ? <p className="dhs-error">{revenueCatError}</p> : null}
        {actionError ? <p className="dhs-error">{actionError}</p> : null}
        <div className="dhs-plan-links">
          <Link href="/pricing" className="btn btn-ghost btn-sm">
            Compare all features
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!configured || restoring}
            onClick={() => void handleRestore()}
          >
            {restoring ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            {restoring ? "Refreshing…" : "Restore purchases"}
          </button>
          <span className="dh-spacer" />
          <span className="dhs-hint">Prices are in CAD.</span>
        </div>
      </section>
    </>
  );
}
