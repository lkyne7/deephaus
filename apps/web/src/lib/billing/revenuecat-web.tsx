"use client";

import type {
  CustomerInfo,
  Offerings,
  Package,
  PurchaseResult,
  Purchases as PurchasesInstance,
} from "@revenuecat/purchases-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const WEB_API_KEY = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY?.trim() ?? "";

type RevenueCatWebContextValue = {
  configured: boolean;
  loading: boolean;
  offerings: Offerings | null;
  customerInfo: CustomerInfo | null;
  managementURL: string | null;
  error: string | null;
  purchasePackage: (rcPackage: Package, customerEmail?: string) => Promise<PurchaseResult>;
  refreshOfferings: () => Promise<Offerings | null>;
  refreshCustomerInfo: () => Promise<CustomerInfo | null>;
  restorePurchases: () => Promise<CustomerInfo | null>;
};

const RevenueCatWebContext = createContext<RevenueCatWebContextValue | null>(null);

type RevenueCatModule = typeof import("@revenuecat/purchases-js");

let modulePromise: Promise<RevenueCatModule> | null = null;
let purchasesPromise: Promise<PurchasesInstance> | null = null;

function getRevenueCatModule(): Promise<RevenueCatModule> {
  modulePromise ??= import("@revenuecat/purchases-js");
  return modulePromise;
}

async function getPurchases(appUserId: string): Promise<PurchasesInstance> {
  if (!purchasesPromise) {
    purchasesPromise = (async () => {
      if (!WEB_API_KEY) {
        throw new Error("RevenueCat web billing is not configured.");
      }

      const { Purchases } = await getRevenueCatModule();
      if (!Purchases.isConfigured()) {
        return Purchases.configure({ apiKey: WEB_API_KEY, appUserId });
      }

      const purchases = Purchases.getSharedInstance();
      if (purchases.getAppUserId() !== appUserId) {
        await purchases.changeUser(appUserId);
      }
      return purchases;
    })().catch((error) => {
      purchasesPromise = null;
      throw error;
    });
  }

  const purchases = await purchasesPromise;
  if (purchases.getAppUserId() !== appUserId) {
    await purchases.changeUser(appUserId);
  }
  return purchases;
}

export function isRevenueCatCancellation(error: unknown): boolean {
  // ErrorCode.UserCancelledError is 1 in the installed purchases-js API.
  return (
    typeof error === "object" &&
    error !== null &&
    "errorCode" in error &&
    error.errorCode === 1
  );
}

export function revenueCatErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { underlyingErrorMessage?: unknown; message?: unknown };
    if (typeof candidate.underlyingErrorMessage === "string" && candidate.underlyingErrorMessage) {
      return candidate.underlyingErrorMessage;
    }
    if (typeof candidate.message === "string" && candidate.message) return candidate.message;
  }
  return error instanceof Error ? error.message : "RevenueCat could not complete the request.";
}

export function RevenueCatWebProvider({
  appUserId,
  children,
}: {
  appUserId: string;
  children: ReactNode;
}) {
  const [offerings, setOfferings] = useState<Offerings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(WEB_API_KEY));
  const [error, setError] = useState<string | null>(null);

  const refreshOfferings = useCallback(async () => {
    if (!WEB_API_KEY) return null;
    try {
      const purchases = await getPurchases(appUserId);
      const nextOfferings = await purchases.getOfferings({ currency: "CAD" });
      setOfferings(nextOfferings);
      setError(null);
      return nextOfferings;
    } catch (failure) {
      setError(revenueCatErrorMessage(failure));
      return null;
    }
  }, [appUserId]);

  const refreshCustomerInfo = useCallback(async () => {
    if (!WEB_API_KEY) return null;
    try {
      const purchases = await getPurchases(appUserId);
      const nextCustomerInfo = await purchases.getCustomerInfo();
      setCustomerInfo(nextCustomerInfo);
      setError(null);
      return nextCustomerInfo;
    } catch (failure) {
      setError(revenueCatErrorMessage(failure));
      return null;
    }
  }, [appUserId]);

  useEffect(() => {
    if (!WEB_API_KEY) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const purchases = await getPurchases(appUserId);
        const [offeringsResult, customerInfoResult] = await Promise.allSettled([
          purchases.getOfferings({ currency: "CAD" }),
          purchases.getCustomerInfo(),
        ]);
        if (!active) return;
        if (offeringsResult.status === "fulfilled") {
          setOfferings(offeringsResult.value);
        }
        if (customerInfoResult.status === "fulfilled") {
          setCustomerInfo(customerInfoResult.value);
        }
        const failure =
          offeringsResult.status === "rejected"
            ? offeringsResult.reason
            : customerInfoResult.status === "rejected"
              ? customerInfoResult.reason
              : null;
        if (failure) setError(revenueCatErrorMessage(failure));
      } catch (failure) {
        if (active) setError(revenueCatErrorMessage(failure));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [appUserId]);

  const purchasePackage = useCallback(
    async (rcPackage: Package, customerEmail?: string) => {
      const purchases = await getPurchases(appUserId);
      const result = await purchases.purchase({
        rcPackage,
        customerEmail,
        skipSuccessPage: true,
      });
      setCustomerInfo(result.customerInfo);
      return result;
    },
    [appUserId],
  );

  // purchases-js has no mobile-style restorePurchases API. A fresh customer
  // info request is the supported web equivalent because purchases are tied
  // to this authenticated app user ID.
  const restorePurchases = refreshCustomerInfo;

  const value = useMemo<RevenueCatWebContextValue>(
    () => ({
      configured: Boolean(WEB_API_KEY),
      loading,
      offerings,
      customerInfo,
      managementURL: customerInfo?.managementURL ?? null,
      error,
      purchasePackage,
      refreshOfferings,
      refreshCustomerInfo,
      restorePurchases,
    }),
    [
      customerInfo,
      error,
      loading,
      offerings,
      purchasePackage,
      refreshCustomerInfo,
      refreshOfferings,
      restorePurchases,
    ],
  );

  return <RevenueCatWebContext.Provider value={value}>{children}</RevenueCatWebContext.Provider>;
}

export function useRevenueCatWeb(): RevenueCatWebContextValue {
  const context = useContext(RevenueCatWebContext);
  if (!context) throw new Error("RevenueCatWebProvider required");
  return context;
}
