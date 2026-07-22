import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";

export type BillingPlan = "plus" | "pro";
export type BillingPeriod = "monthly" | "annual";

export type BillingAvailability = {
  available: boolean;
  reason: string | null;
};

export type BillingPackageOption = {
  plan: BillingPlan;
  period: BillingPeriod;
  packageIdentifier: string;
  productIdentifier: string;
  price: string;
  pricePerMonth: string | null;
};

export type BillingData = {
  offerings: PurchasesOfferings;
  customerInfo: CustomerInfo;
  packages: BillingPackageOption[];
};

type PurchasesModule = typeof import("react-native-purchases").default;

const extra = Constants.expoConfig?.extra as
  | {
      revenueCatIosApiKey?: string;
      revenueCatAndroidApiKey?: string;
    }
  | undefined;

let purchasesModule: PurchasesModule | null = null;
let configured = false;
let configuredUserId: string | null = null;
let identityOperation: Promise<unknown> = Promise.resolve();

function readConfigValue(value: string | undefined): string {
  if (!value || value.startsWith("${")) return "";
  return value.trim();
}

function platformApiKey(): string {
  if (Platform.OS === "ios") return readConfigValue(extra?.revenueCatIosApiKey);
  if (Platform.OS === "android") return readConfigValue(extra?.revenueCatAndroidApiKey);
  return "";
}

export function getBillingAvailability(): BillingAvailability {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return { available: false, reason: "Subscriptions are only available on iOS and Android." };
  }
  if (Constants.appOwnership === "expo") {
    return {
      available: false,
      reason: "Subscriptions require a DeepHaus development or store build, not Expo Go.",
    };
  }
  if (!platformApiKey()) {
    return {
      available: false,
      reason: `RevenueCat is not configured for ${Platform.OS}.`,
    };
  }
  return { available: true, reason: null };
}

async function getPurchases(): Promise<PurchasesModule> {
  const availability = getBillingAvailability();
  if (!availability.available) throw new Error(availability.reason ?? "Subscriptions are unavailable.");
  if (!purchasesModule) {
    purchasesModule = (await import("react-native-purchases")).default;
  }
  return purchasesModule;
}

function serializeIdentityOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = identityOperation.then(operation, operation);
  identityOperation = next.catch(() => undefined);
  return next;
}

export function configureBilling(appUserId: string): Promise<BillingAvailability> {
  return serializeIdentityOperation(async () => {
    const availability = getBillingAvailability();
    if (!availability.available) return availability;

    try {
      const Purchases = await getPurchases();
      if (!configured) {
        Purchases.configure({ apiKey: platformApiKey(), appUserID: appUserId });
        configured = true;
        configuredUserId = appUserId;
      } else if (configuredUserId !== appUserId) {
        await Purchases.logIn(appUserId);
        configuredUserId = appUserId;
      }
      return { available: true, reason: null };
    } catch (error) {
      return { available: false, reason: billingErrorMessage(error) };
    }
  });
}

export function logOutBilling(): Promise<void> {
  return serializeIdentityOperation(async () => {
    if (!configured || !configuredUserId) return;
    try {
      const Purchases = await getPurchases();
      await Purchases.logOut();
    } finally {
      configuredUserId = null;
    }
  });
}

export async function fetchBillingData(): Promise<BillingData> {
  const Purchases = await getPurchases();
  if (!configured) throw new Error("Subscriptions are still initializing.");

  const [offerings, customerInfo] = await Promise.all([
    Purchases.getOfferings(),
    Purchases.getCustomerInfo(),
  ]);

  return {
    offerings,
    customerInfo,
    packages: listSubscriptionOptions(offerings),
  };
}

export async function purchaseSubscription(
  plan: BillingPlan,
  period: BillingPeriod,
): Promise<CustomerInfo> {
  const Purchases = await getPurchases();
  if (!configured) throw new Error("Subscriptions are still initializing.");

  const offerings = await Purchases.getOfferings();
  const selectedPackage = findPackage(offerings, plan, period);
  if (!selectedPackage) {
    throw new Error(`${titleCase(plan)} ${period} is not available from the store right now.`);
  }

  const result = await Purchases.purchasePackage(selectedPackage);
  return result.customerInfo;
}

export async function restoreBillingPurchases(): Promise<CustomerInfo> {
  const Purchases = await getPurchases();
  if (!configured) throw new Error("Subscriptions are still initializing.");
  return Purchases.restorePurchases();
}

export async function openBillingManagement(): Promise<void> {
  const Purchases = await getPurchases();
  if (!configured) throw new Error("Subscriptions are still initializing.");

  const customerInfo = await Purchases.getCustomerInfo();
  if (customerInfo.managementURL && (await Linking.canOpenURL(customerInfo.managementURL))) {
    await Linking.openURL(customerInfo.managementURL);
    return;
  }

  try {
    const RevenueCatUI = (await import("react-native-purchases-ui")).default;
    await RevenueCatUI.presentCustomerCenter();
    return;
  } catch {
    // Customer Center may not be configured yet; fall back to the platform subscription screen.
  }

  try {
    await Purchases.showManageSubscriptions();
    return;
  } catch {
    // The account may not have a subscription from the current app store.
  }

  throw new Error("No subscription management page is available for this account.");
}

export function isPurchaseCancelled(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; userCancelled?: unknown };
  return (
    candidate.userCancelled === true ||
    candidate.code === "PURCHASE_CANCELLED_ERROR" ||
    candidate.code === "1"
  );
}

export function billingErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Subscriptions could not be loaded. Please try again.";
}

function listSubscriptionOptions(offerings: PurchasesOfferings): BillingPackageOption[] {
  const options: BillingPackageOption[] = [];
  for (const plan of ["plus", "pro"] as const) {
    for (const period of ["monthly", "annual"] as const) {
      const selectedPackage = findPackage(offerings, plan, period);
      if (!selectedPackage) continue;
      options.push({
        plan,
        period,
        packageIdentifier: selectedPackage.identifier,
        productIdentifier: selectedPackage.product.identifier,
        price: selectedPackage.product.priceString,
        pricePerMonth: selectedPackage.product.pricePerMonthString,
      });
    }
  }
  return options;
}

function findPackage(
  offerings: PurchasesOfferings,
  plan: BillingPlan,
  period: BillingPeriod,
): PurchasesPackage | null {
  const planOffering = findPlanOffering(offerings, plan);
  if (planOffering) {
    const standardPackage = period === "monthly" ? planOffering.monthly : planOffering.annual;
    if (standardPackage) return standardPackage;

    const customPackage = planOffering.availablePackages.find((candidate) =>
      packageMatches(candidate, period),
    );
    if (customPackage) return customPackage;
  }

  for (const offering of Object.values(offerings.all)) {
    const planIsInOffering = identifierContains(offering.identifier, plan);
    const match = offering.availablePackages.find((candidate) => {
      const planMatches =
        planIsInOffering ||
        identifierContains(candidate.identifier, plan) ||
        identifierContains(candidate.product.identifier, plan);
      return planMatches && packageMatches(candidate, period);
    });
    if (match) return match;
  }

  return null;
}

function findPlanOffering(
  offerings: PurchasesOfferings,
  plan: BillingPlan,
): PurchasesOffering | null {
  const exact = offerings.all[plan] ?? offerings.all[`deephaus_${plan}`] ?? offerings.all[`${plan}_offering`];
  if (exact) return exact;
  return Object.values(offerings.all).find((offering) => identifierContains(offering.identifier, plan)) ?? null;
}

function packageMatches(candidate: PurchasesPackage, period: BillingPeriod): boolean {
  const expectedType = period === "monthly" ? "MONTHLY" : "ANNUAL";
  if (candidate.packageType === expectedType) return true;

  const identifiers = `${candidate.identifier} ${candidate.product.identifier}`.toLowerCase();
  return period === "monthly"
    ? /(^|[._-])(month|monthly|1m)([._-]|$)/.test(identifiers)
    : /(^|[._-])(annual|annually|year|yearly|1y)([._-]|$)/.test(identifiers);
}

function identifierContains(identifier: string, value: string): boolean {
  return new RegExp(`(^|[._-])${value}([._-]|$)`, "i").test(identifier);
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
