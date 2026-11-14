import {
  DEFAULT_REVIEW_ORDER,
  parseEasyDays,
  parsePartialReviewOrder,
  normalEasyDays,
  type EasyDays,
  type ReviewOrderSettings,
} from "@deephaus/shared";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  billingErrorMessage,
  configureBilling,
  fetchBillingData,
  getBillingAvailability,
  isPurchaseCancelled,
  openBillingManagement,
  purchaseSubscription,
  restoreBillingPurchases,
  type BillingPackageOption,
  type BillingPeriod,
  type BillingPlan,
} from "@/lib/billing";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { useCardFont } from "@/lib/study/card-font";
import { useTheme } from "@/lib/theme-context";

/** The saved review order, with defaults for anything a server before it left out. */
function savedReviewOrder(settings: { reviewOrder?: Partial<ReviewOrderSettings> }): ReviewOrderSettings {
  return { ...DEFAULT_REVIEW_ORDER, ...parsePartialReviewOrder(settings.reviewOrder) };
}
import type {
  BillingStatus,
  DashboardStats,
  FsrsSettingsResponse,
  UniversityOption,
  UserProfile,
} from "@deephaus/api-client";

export const FSRS_TARGET = 100;

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function extractOptimizeError(e: unknown): string {
  if (e instanceof Error) {
    // ApiError carries the raw response body; surface the JSON `error` field.
    try {
      const parsed = JSON.parse(e.message) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      // not JSON — fall through to the raw message
    }
    if (e.message) return e.message;
  }
  return "Failed to optimize. Please try again.";
}

/** State and actions behind Settings, shared by the iOS form and the Android list. */
export function useSettingsModel() {
  const { preference, setPreference } = useTheme();
  const { user, signOut } = useAuth();
  const cardFont = useCardFont();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [globalFsrs, setGlobalFsrs] = useState<FsrsSettingsResponse | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [universityQuery, setUniversityQuery] = useState("");
  const [selectedUniversityId, setSelectedUniversityId] = useState<string | null>(null);
  const [universityResults, setUniversityResults] = useState<UniversityOption[]>([]);
  const [universitySearchBusy, setUniversitySearchBusy] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingUniversity, setPendingUniversity] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [verifyingUniversity, setVerifyingUniversity] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [retentionPct, setRetentionPct] = useState(90);
  const [newCardsPerDay, setNewCardsPerDay] = useState(10);
  const [easyDays, setEasyDays] = useState<EasyDays>(normalEasyDays);
  const [dayStartHour, setDayStartHour] = useState(4);
  const [reviewOrder, setReviewOrder] = useState<ReviewOrderSettings>(DEFAULT_REVIEW_ORDER);
  const [savedGlobalFsrs, setSavedGlobalFsrs] = useState<FsrsSettingsResponse | null>(null);
  const [savingFsrs, setSavingFsrs] = useState(false);
  const [fsrsSaveError, setFsrsSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizedAtOverride, setOptimizedAtOverride] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingPackages, setBillingPackages] = useState<BillingPackageOption[]>([]);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingBusy, setBillingBusy] = useState<string | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingUnavailableReason, setBillingUnavailableReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Settle each request independently: stats resolve from the local replica
    // offline, so an unreachable API for FSRS/profile must not blank the whole
    // screen.
    const [statsResult, fsrsResult, profileResult] = await Promise.allSettled([
      offlineData.getDashboardStats(),
      api.getFsrsSettings(),
      api.getProfile(),
    ]);
    setStats(statsResult.status === "fulfilled" ? statsResult.value : null);
    if (fsrsResult.status === "fulfilled") {
      const nextFsrs = fsrsResult.value;
      setGlobalFsrs(nextFsrs);
      setSavedGlobalFsrs(nextFsrs);
      setRetentionPct(Math.round(nextFsrs.desiredRetention * 100));
      setNewCardsPerDay(nextFsrs.newCardsPerDay);
      setDayStartHour(nextFsrs.dayStartHour ?? 4);
      setEasyDays(parseEasyDays(nextFsrs.easyDays));
      setReviewOrder(savedReviewOrder(nextFsrs));
    } else {
      setGlobalFsrs(null);
    }
    if (profileResult.status === "fulfilled") {
      const nextProfile = profileResult.value;
      setProfile(nextProfile);
      setFullName(nextProfile.full_name);
      setUsername(nextProfile.username);
      setSchoolEmail(nextProfile.university_email ?? "");
      setUniversityQuery(nextProfile.university_name ?? "");
    } else {
      setProfile(null);
    }
    setLoading(false);
  }, []);

  const loadBilling = useCallback(async (showSpinner = true) => {
    if (!user?.id) {
      setBillingLoading(false);
      return;
    }

    if (showSpinner) setBillingLoading(true);
    setBillingError(null);

    const statusPromise = api.getBillingStatus();
    const availability = await configureBilling(user.id);
    setBillingUnavailableReason(availability.reason);
    const nativePromise = availability.available
      ? fetchBillingData()
      : Promise.resolve(null);

    const [statusResult, nativeResult] = await Promise.allSettled([
      statusPromise,
      nativePromise,
    ]);

    const errors: string[] = [];
    if (statusResult.status === "fulfilled") {
      setBillingStatus(statusResult.value);
    } else {
      setBillingStatus(null);
      errors.push(billingErrorMessage(statusResult.reason));
    }

    if (nativeResult.status === "fulfilled") {
      setBillingPackages(nativeResult.value?.packages ?? []);
    } else {
      setBillingPackages([]);
      errors.push(billingErrorMessage(nativeResult.reason));
    }

    setBillingError(errors.length > 0 ? errors.join(" ") : null);
    setBillingLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    const query = universityQuery.trim();
    if (query.length < 2 || query === profile?.university_name) {
      setUniversityResults([]);
      setUniversitySearchBusy(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setUniversitySearchBusy(true);
      try {
        const result = await api.searchUniversities(query, 6);
        if (active) setUniversityResults(result.universities);
      } catch {
        if (active) setUniversityResults([]);
      } finally {
        if (active) setUniversitySearchBusy(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [profile?.university_name, universityQuery]);

  const globalFsrsDirty =
    savedGlobalFsrs != null &&
    (Math.round(savedGlobalFsrs.desiredRetention * 100) !== retentionPct ||
      savedGlobalFsrs.newCardsPerDay !== newCardsPerDay ||
      (savedGlobalFsrs.dayStartHour ?? 4) !== dayStartHour ||
      JSON.stringify(parseEasyDays(savedGlobalFsrs.easyDays)) !== JSON.stringify(easyDays) ||
      JSON.stringify(savedReviewOrder(savedGlobalFsrs)) !== JSON.stringify(reviewOrder));

  const handleSaveGlobalFsrs = useCallback(async () => {
    if (!easyDays.includes("normal")) return;
    setSavingFsrs(true);
    setFsrsSaveError(null);
    try {
      const updated = await api.updateFsrsSettings({
        desiredRetention: retentionPct / 100,
        newCardsPerDay,
        dayStartHour,
        easyDays,
        reviewOrder,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      });
      setGlobalFsrs(updated);
      setSavedGlobalFsrs(updated);
    } catch (e) {
      setFsrsSaveError(extractOptimizeError(e));
    } finally {
      setSavingFsrs(false);
    }
  }, [newCardsPerDay, retentionPct, dayStartHour, easyDays, reviewOrder]);

  const handleDeleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await api.deleteAccount();
      Alert.alert("Deletion started", "Your account and files will be removed in the background.");
      haptics.success();
      // The auth session is gone server-side; signing out routes back to the
      // splash screen via the root auth guard.
      await signOut();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete account");
      setDeletingAccount(false);
    }
  }, [signOut]);

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      await api.optimizeFsrs();
      setOptimizedAtOverride(new Date().toISOString());
      await load();
    } catch (e) {
      setOptimizeError(extractOptimizeError(e));
    } finally {
      setOptimizing(false);
    }
  }, [load]);

  const handleSaveProfile = useCallback(async () => {
    setSavingProfile(true);
    setProfileError(null);
    try {
      const updated = await api.updateProfile({
        full_name: fullName,
        username,
      });
      setProfile(updated);
      setFullName(updated.full_name);
      setUsername(updated.username);
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setSavingProfile(false);
    }
  }, [fullName, username]);

  const handleSendUniversityCode = useCallback(async () => {
    setVerifyingUniversity(true);
    setProfileError(null);
    try {
      const result = await api.sendUniversityVerification(
        schoolEmail.trim(),
        selectedUniversityId,
      );
      setPendingUniversity(result.university_name);
      setSelectedUniversityId(result.university_id);
      setUniversityQuery(result.university_name);
      setProfile((current) =>
        current
          ? {
              ...current,
              university_name: result.university_name,
              university_email_verified_at: null,
            }
          : current,
      );
      setVerificationCode("");
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setVerifyingUniversity(false);
    }
  }, [schoolEmail, selectedUniversityId]);

  const handleVerifyUniversity = useCallback(async () => {
    setVerifyingUniversity(true);
    setProfileError(null);
    try {
      const result = await api.verifyUniversityEmail(
        schoolEmail.trim(),
        verificationCode,
      );
      setProfile(result.profile);
      setUniversityQuery(result.profile.university_name ?? "");
      setPendingUniversity(null);
      setVerificationCode("");
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setVerifyingUniversity(false);
    }
  }, [schoolEmail, verificationCode]);

  const handleSelectUniversity = useCallback(async (university: UniversityOption) => {
    setUniversitySearchBusy(true);
    setProfileError(null);
    try {
      const updated = await api.updateProfile({ university_id: university.id });
      setProfile(updated);
      setUniversityQuery(updated.university_name ?? university.name);
      setSelectedUniversityId(university.id);
      setUniversityResults([]);
      setSchoolEmail("");
      setPendingUniversity(null);
    } catch (e) {
      setProfileError(extractOptimizeError(e));
    } finally {
      setUniversitySearchBusy(false);
    }
  }, []);

  const handlePurchase = useCallback(
    async (plan: BillingPlan, period: BillingPeriod) => {
      const operation = `${plan}-${period}`;
      setBillingBusy(operation);
      setBillingError(null);
      setBillingMessage(null);
      try {
        await purchaseSubscription(plan, period);
        await loadBilling(false);
        setBillingMessage(
          `${titleCase(plan)} was purchased successfully. Server access may take a moment to update.`,
        );
      } catch (error) {
        if (!isPurchaseCancelled(error)) setBillingError(billingErrorMessage(error));
      } finally {
        setBillingBusy(null);
      }
    },
    [loadBilling],
  );

  const handleRestoreBilling = useCallback(async () => {
    setBillingBusy("restore");
    setBillingError(null);
    setBillingMessage(null);
    try {
      await restoreBillingPurchases();
      await loadBilling(false);
      setBillingMessage("Purchases restored.");
    } catch (error) {
      setBillingError(billingErrorMessage(error));
    } finally {
      setBillingBusy(null);
    }
  }, [loadBilling]);

  const handleManageBilling = useCallback(async () => {
    setBillingBusy("manage");
    setBillingError(null);
    setBillingMessage(null);
    try {
      await openBillingManagement();
    } catch (error) {
      setBillingError(billingErrorMessage(error));
    } finally {
      setBillingBusy(null);
    }
  }, []);

  const email = user?.email ?? "";
  const name = profile?.full_name || user?.user_metadata?.full_name || email.split("@")[0] || "DeepHaus user";
  const nameParts = String(name).trim().split(/\s+/).filter(Boolean);
  const initials =
    (nameParts.length > 1
      ? `${nameParts[0]?.[0] ?? ""}${nameParts[nameParts.length - 1]?.[0] ?? ""}`
      : nameParts[0]?.slice(0, 2))?.toUpperCase() || "DH";

  const totalCards = stats?.total_cards ?? 0;

  const fsrsLogCount = stats?.fsrs_log_count ?? 0;
  const fsrsProgress = Math.min(fsrsLogCount, FSRS_TARGET);
  const optimizerReady = fsrsLogCount >= FSRS_TARGET;
  const lastOptimizedAt = optimizedAtOverride ?? stats?.last_optimized_at ?? null;
  const creditUsage = billingStatus
    ? Math.min(
        billingStatus.credits.used + billingStatus.credits.reserved,
        billingStatus.credits.allowance,
      )
    : 0;
  const nativeBillingAvailable =
    getBillingAvailability().available && billingUnavailableReason == null;

  return {
    stats,
    setStats,
    globalFsrs,
    setGlobalFsrs,
    profile,
    setProfile,
    fullName,
    setFullName,
    username,
    setUsername,
    schoolEmail,
    setSchoolEmail,
    universityQuery,
    setUniversityQuery,
    selectedUniversityId,
    setSelectedUniversityId,
    universityResults,
    setUniversityResults,
    universitySearchBusy,
    setUniversitySearchBusy,
    verificationCode,
    setVerificationCode,
    pendingUniversity,
    setPendingUniversity,
    savingProfile,
    setSavingProfile,
    verifyingUniversity,
    setVerifyingUniversity,
    profileError,
    setProfileError,
    retentionPct,
    setRetentionPct,
    newCardsPerDay,
    setNewCardsPerDay,
    easyDays,
    setEasyDays,
    dayStartHour,
    setDayStartHour,
    reviewOrder,
    setReviewOrder,
    savedGlobalFsrs,
    setSavedGlobalFsrs,
    savingFsrs,
    setSavingFsrs,
    fsrsSaveError,
    setFsrsSaveError,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    deleteConfirming,
    setDeleteConfirming,
    deleteText,
    setDeleteText,
    deletingAccount,
    setDeletingAccount,
    deleteError,
    setDeleteError,
    optimizing,
    setOptimizing,
    optimizeError,
    setOptimizeError,
    optimizedAtOverride,
    setOptimizedAtOverride,
    billingStatus,
    setBillingStatus,
    billingPackages,
    setBillingPackages,
    billingLoading,
    setBillingLoading,
    billingBusy,
    setBillingBusy,
    billingMessage,
    setBillingMessage,
    billingError,
    setBillingError,
    billingUnavailableReason,
    setBillingUnavailableReason,
    preference,
    setPreference,
    user,
    signOut,
    cardFont,
    load,
    loadBilling,
    globalFsrsDirty,
    handleSaveGlobalFsrs,
    handleDeleteAccount,
    handleOptimize,
    handleSaveProfile,
    handleSendUniversityCode,
    handleVerifyUniversity,
    handleSelectUniversity,
    handlePurchase,
    handleRestoreBilling,
    handleManageBilling,
    email,
    name,
    nameParts,
    initials,
    totalCards,
    fsrsLogCount,
    fsrsProgress,
    optimizerReady,
    lastOptimizedAt,
    creditUsage,
    nativeBillingAvailable,
  };
}

export type SettingsModel = ReturnType<typeof useSettingsModel>;
