"use client";

import type { Package } from "@revenuecat/purchases-js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isRevenueCatCancellation,
  revenueCatErrorMessage,
  useRevenueCatWeb,
} from "@/lib/billing/revenuecat-web";
import type { BillingStatus } from "@/lib/billing/server";
import { OfflineNotice } from "@/components/offline-gate";
import { SettingsLoadingState } from "@/components/settings/settings-overlay";
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

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function readDiscountCodeFromUrl(): string | null {
  const value = new URL(window.location.href).searchParams.get("discount_code")?.trim();
  return value || null;
}

function cleanBillingFlags(): string | null {
  const url = new URL(window.location.href);
  const keys = ["billing", "billing_status", "purchase"];
  let notice: string | null = null;
  let changed = false;

  for (const key of keys) {
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

  if (changed) {
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  return notice;
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
  const online = useOnline();

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
    setNotice(cleanBillingFlags());
    setDiscountCode(readDiscountCodeFromUrl());
    void loadStatus();
  }, [loadStatus]);

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
    <div style={s.root}>
      {notice ? <div style={s.notice}>{notice}</div> : null}
      {statusError ? (
        <div style={s.errorBanner}>
          <span>{statusError}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadStatus()}>
            Retry
          </button>
        </div>
      ) : null}

      {billing ? (
        <>
          <section style={s.block}>
            <div style={s.sectionHead}>
              <div>
                <div style={s.blockTitle}>Current plan</div>
                <p style={s.subtle}>Your subscription and renewal details.</p>
              </div>
              <span style={s.planBadge}>{planLabel(billing.plan)}</span>
            </div>
            <div style={s.detailGrid}>
              <div style={s.detail}>
                <span style={s.detailLabel}>Status</span>
                <strong style={s.detailValue}>
                  {billing.plan === "basic" && billing.status === "inactive"
                    ? "Free plan"
                    : statusLabel(billing.status)}
                </strong>
              </div>
              <div style={s.detail}>
                <span style={s.detailLabel}>
                  {billing.willRenew ? "Renews" : "Access through"}
                </span>
                <strong style={s.detailValue}>
                  {formatDate(billing.expiresAt) ?? (billing.plan === "basic" ? "No expiry" : "—")}
                </strong>
              </div>
            </div>
            {managementURL ? (
              <a href={managementURL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={s.selfStart}>
                Manage subscription <i className="ri-external-link-line" aria-hidden />
              </a>
            ) : null}
            {hasActiveSubscription && !revenueCatLoading && !managementURL ? (
              <div style={s.configState}>
                <i className="ri-information-line" aria-hidden />
                <div>
                  <strong>Subscription management is unavailable</strong>
                  <p>Contact support to cancel or change your current subscription.</p>
                </div>
              </div>
            ) : null}
          </section>

          <section style={s.block}>
            <div style={s.sectionHead}>
              <div>
                <div style={s.blockTitle}>AI credits</div>
                <p style={s.subtle}>
                  {billing.credits.remaining.toLocaleString()} credits remaining this period.
                </p>
              </div>
              <strong style={s.creditTotal}>
                {(used + reserved).toLocaleString()} / {allowance.toLocaleString()}
              </strong>
            </div>
            <div
              style={s.meter}
              role="progressbar"
              aria-label="AI credits used or reserved"
              aria-valuemin={0}
              aria-valuemax={allowance}
              aria-valuenow={Math.min(allowance, used + reserved)}
            >
              <span style={{ ...s.usedBar, width: `${usedPercent}%` }} />
              <span style={{ ...s.reservedBar, width: `${reservedPercent}%` }} />
            </div>
            <div style={s.creditLegend}>
              <span><i style={{ ...s.legendDot, background: "var(--brand-500)" }} />{used.toLocaleString()} used</span>
              <span><i style={{ ...s.legendDot, background: "var(--brand-200)" }} />{reserved.toLocaleString()} reserved</span>
              <span>{billing.credits.remaining.toLocaleString()} remaining</span>
            </div>
            {formatDate(billing.credits.periodEnd) ? (
              <span style={s.subtle}>Credits reset {formatDate(billing.credits.periodEnd)}.</span>
            ) : null}
          </section>
        </>
      ) : null}

      <section style={s.block}>
        <div>
          <div style={s.blockTitle}>Plans</div>
          <p style={s.subtle}>Choose monthly or save with annual billing. Prices are in CAD.</p>
        </div>

        {!configured ? (
          <div style={s.configState}>
            <i className="ri-information-line" aria-hidden />
            <div>
              <strong>Web purchases are not configured</strong>
              <p>
                Add <code>NEXT_PUBLIC_REVENUECAT_WEB_API_KEY</code> to enable checkout.
                Your current plan and credit usage are still available above.
              </p>
            </div>
          </div>
        ) : revenueCatLoading ? (
          <SettingsLoadingState label="Loading plan options…" />
        ) : packageChoices.length === 0 ? (
          <div style={s.configState}>
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
          <div style={s.planGrid}>
            {(["plus", "pro"] as const).map((plan) => {
              const monthly = packageChoices.find(
                (choice) => choice.plan === plan && choice.cadence === "monthly",
              );
              const annual = packageChoices.find(
                (choice) => choice.plan === plan && choice.cadence === "annual",
              );
              return (
                <div key={plan} style={s.planCard}>
                  <div style={s.planCardHead}>
                    <strong>{planLabel(plan)}</strong>
                    <span>{plan === "plus" ? "3,000" : "8,000"} credits / month</span>
                  </div>
                  {[monthly, annual].map((choice, index) => {
                    const cadence = index === 0 ? "Monthly" : "Annual";
                    const productId = choice?.rcPackage.webBillingProduct.identifier;
                    const busy = Boolean(productId && busyPackageId === productId);
                    const currentProduct = Boolean(
                      productId && billing?.productId === productId && hasActiveSubscription,
                    );
                    return (
                      <div key={cadence} style={s.packageRow}>
                        <div style={s.packageCopy}>
                          <span>{cadence}</span>
                          <strong>
                            {choice?.rcPackage.webBillingProduct.price.formattedPrice ?? "Unavailable"}
                            {choice ? <small> / {index === 0 ? "month" : "year"}</small> : null}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={!choice || currentProduct || Boolean(busyPackageId)}
                          onClick={() => choice && handlePlanAction(choice)}
                        >
                          {busy
                            ? "Opening…"
                            : currentProduct
                              ? "Current"
                              : hasActiveSubscription
                                ? "Manage"
                                : "Choose"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {revenueCatError ? <p style={s.error}>{revenueCatError}</p> : null}
        {actionError ? <p style={s.error}>{actionError}</p> : null}
        <div style={s.billingActions}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!configured || restoring}
            onClick={() => void handleRestore()}
          >
            <i className={restoring ? "ri-loader-4-line icon-spin" : "ri-refresh-line"} aria-hidden />
            {restoring ? "Refreshing…" : "Restore purchases"}
          </button>
          <Link href="/pricing" className="btn btn-ghost btn-sm">Compare all features</Link>
        </div>
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: 24 },
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingBottom: 24,
    borderBottom: "1px solid var(--border-secondary)",
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  blockTitle: { font: "600 15px/20px var(--font-sans)", color: "var(--fg-primary)" },
  subtle: { margin: "3px 0 0", color: "var(--fg-quaternary)", font: "400 12px/18px var(--font-sans)" },
  planBadge: {
    padding: "5px 10px",
    borderRadius: 999,
    background: "var(--brand-50)",
    border: "1px solid var(--brand-200)",
    color: "var(--brand-700)",
    font: "600 12px/16px var(--font-sans)",
  },
  detailGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    padding: 12,
    borderRadius: 8,
    background: "var(--bg-surface-2)",
  },
  detailLabel: { color: "var(--fg-quaternary)", font: "500 11px/16px var(--font-sans)" },
  detailValue: { color: "var(--fg-primary)", font: "600 13px/18px var(--font-sans)" },
  selfStart: { alignSelf: "flex-start" },
  creditTotal: { color: "var(--fg-secondary)", font: "600 13px/20px var(--font-sans)" },
  meter: {
    display: "flex",
    height: 10,
    overflow: "hidden",
    borderRadius: 999,
    background: "var(--bg-surface-2)",
  },
  usedBar: { height: "100%", background: "var(--brand-500)" },
  reservedBar: { height: "100%", background: "var(--brand-200)" },
  creditLegend: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    color: "var(--fg-quaternary)",
    font: "500 11px/16px var(--font-sans)",
  },
  legendDot: {
    display: "inline-block",
    width: 8,
    height: 8,
    marginRight: 5,
    borderRadius: "50%",
  },
  configState: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--fg-tertiary)",
    font: "400 13px/19px var(--font-sans)",
  },
  planGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  planCard: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    overflow: "hidden",
    border: "1px solid var(--border-secondary)",
    borderRadius: 10,
  },
  planCardHead: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "12px 14px",
    background: "var(--bg-surface-2)",
    color: "var(--fg-primary)",
    font: "600 14px/19px var(--font-sans)",
  },
  packageRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px",
    borderTop: "1px solid var(--border-tertiary)",
  },
  packageCopy: {
    display: "flex",
    flexDirection: "column",
    color: "var(--fg-quaternary)",
    font: "500 11px/16px var(--font-sans)",
  },
  billingActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  notice: {
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--brand-50)",
    border: "1px solid var(--brand-200)",
    color: "var(--brand-700)",
    font: "500 13px/18px var(--font-sans)",
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--grade-again-bg)",
    border: "1px solid var(--grade-again-border)",
    color: "var(--grade-again)",
    font: "500 13px/18px var(--font-sans)",
  },
  error: { margin: 0, color: "var(--grade-again)", font: "400 13px/18px var(--font-sans)" },
};
