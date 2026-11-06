import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { BillingStatus } from "@deephaus/api-client";
import { LegalLinks } from "@/components/legal-links";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { UIText } from "@/components/ui/text";
import type { SettingsModel } from "@/components/settings/use-settings-model";
import type { BillingPackageOption, BillingPeriod, BillingPlan } from "@/lib/billing";
import { emphasisFont } from "@/lib/fonts";
import { cardFontStyle, type CardFont } from "@/lib/study/card-font";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const months = Math.floor(day / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function formatBillingStatus(value: BillingStatus["status"]): string {
  return value.replace(/_/g, " ");
}

/** Sample of the chosen card font; the serif here is a card preview. */
export function CardFontSample({ cardFont }: { cardFont: CardFont }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const font = cardFontStyle(cardFont);
  return (
    <View style={styles.fontSample}>
      <Text style={[styles.fontSampleText, font]}>
        What is <Text style={emphasisFont(font.fontFamily, 600)}>chemiosmosis</Text>?
      </Text>
    </View>
  );
}

export function ProfilePanel({ model }: { model: SettingsModel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { fullName, setFullName, username, setUsername, savingProfile } = model;
  return (
    <>
      <View>
        <Text style={styles.fieldLabel}>Full name</Text>
        <Field
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          autoCapitalize="words"
          autoComplete="name"
        />
      </View>
      <View>
        <Text style={styles.fieldLabel}>Username</Text>
        <Field
          value={username}
          onChangeText={(value) =>
            setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30))
          }
          placeholder="username"
          autoCapitalize="none"
          autoComplete="username"
        />
        <Text style={styles.fieldHint}>Shown publicly as @{username || "username"}.</Text>
      </View>
      <Button
        variant="secondary"
        size="md"
        label={savingProfile ? "Saving…" : "Save profile"}
        onPress={() => void model.handleSaveProfile()}
        disabled={savingProfile || fullName.trim().length === 0 || username.length < 3}
        loading={savingProfile}
        fullWidth
      />
    </>
  );
}

export function UniversityPanel({ model }: { model: SettingsModel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    profile,
    universityQuery,
    setUniversityQuery,
    setSelectedUniversityId,
    universitySearchBusy,
    universityResults,
    schoolEmail,
    setSchoolEmail,
    pendingUniversity,
    setPendingUniversity,
    verifyingUniversity,
    verificationCode,
    setVerificationCode,
    profileError,
  } = model;
  return (
    <>
      <View>
        <Text style={styles.fieldLabel}>University</Text>
        <Field
          value={universityQuery}
          onChangeText={(value) => {
            setUniversityQuery(value);
            setSelectedUniversityId(null);
          }}
          placeholder="Search by university name or domain"
          autoCapitalize="words"
          autoComplete="organization"
        />
        {universitySearchBusy ? (
          <ActivityIndicator color={colors.accent} style={styles.searchSpinner} />
        ) : null}
        {universityResults.length > 0 ? (
          <View style={styles.universityResults}>
            {universityResults.map((university, index) => (
              <Pressable
                key={university.id}
                accessibilityRole="button"
                accessibilityLabel={`Select ${university.name}`}
                style={({ pressed }) => [
                  styles.universityOption,
                  index > 0 && styles.rowDivider,
                  pressed && styles.universityOptionPressed,
                ]}
                onPress={() => void model.handleSelectUniversity(university)}
              >
                <Text style={styles.universityOptionName}>{university.name}</Text>
                <Text style={styles.universityOptionMeta}>
                  {university.country} · {university.domains[0]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.fieldHint}>
          Selecting a university does not verify affiliation. Use the email code below.
        </Text>
      </View>
      {profile?.university_name ? (
        <Text style={styles.schoolName}>
          {profile.university_name}
          {!profile.university_email_verified_at ? (
            <Text style={styles.unverifiedText}> · Unverified</Text>
          ) : null}
        </Text>
      ) : null}
      <View>
        <Text style={styles.fieldLabel}>University email</Text>
        <Field
          value={schoolEmail}
          onChangeText={(value) => {
            setSchoolEmail(value);
            setPendingUniversity(null);
          }}
          placeholder="you@university.edu"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
      </View>
      <Button
        variant="secondary"
        size="md"
        label={verifyingUniversity ? "Sending…" : "Send verification code"}
        onPress={() => void model.handleSendUniversityCode()}
        disabled={verifyingUniversity || !schoolEmail.trim()}
        loading={verifyingUniversity && !pendingUniversity}
        fullWidth
      />
      {pendingUniversity ? (
        <View style={{ gap: 10 }}>
          <UIText variant="muted">
            We recognized {pendingUniversity}. Enter the six-digit code sent to your email.
          </UIText>
          <Field
            value={verificationCode}
            onChangeText={(value) => setVerificationCode(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            autoComplete="one-time-code"
          />
          <Button
            variant="primary"
            size="md"
            label={verifyingUniversity ? "Verifying…" : "Verify university"}
            onPress={() => void model.handleVerifyUniversity()}
            disabled={verifyingUniversity || verificationCode.length !== 6}
            loading={verifyingUniversity}
            fullWidth
          />
        </View>
      ) : null}
      {profileError ? <Text style={styles.errorText}>{profileError}</Text> : null}
    </>
  );
}

function PlanTier({
  plan,
  creditAllowance,
  description,
  current,
  packages,
  busy,
  enabled,
  onPurchase,
}: {
  plan: BillingPlan;
  creditAllowance: string;
  description: string;
  current: boolean;
  packages: BillingPackageOption[];
  busy: string | null;
  enabled: boolean;
  onPurchase: (plan: BillingPlan, period: BillingPeriod) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const monthly = packages.find(
    (candidate) => candidate.plan === plan && candidate.period === "monthly",
  );
  const annual = packages.find(
    (candidate) => candidate.plan === plan && candidate.period === "annual",
  );

  return (
    <View style={styles.planTier}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planName}>{titleCase(plan)}</Text>
          <Text style={styles.planCredits}>{creditAllowance}</Text>
        </View>
        {current ? <BadgePill label="Current plan" /> : null}
      </View>
      <UIText variant="muted">{description}</UIText>
      <View style={styles.billingActions}>
        <Button
          variant={plan === "pro" ? "primary" : "secondary"}
          size="sm"
          label={monthly ? `${monthly.price} / month` : "Monthly unavailable"}
          loading={busy === `${plan}-monthly`}
          disabled={!enabled || busy != null || !monthly}
          onPress={() => void onPurchase(plan, "monthly")}
          style={{ flex: 1 }}
        />
        <Button
          variant={plan === "pro" ? "primary" : "secondary"}
          size="sm"
          label={annual ? `${annual.price} / year` : "Annual unavailable"}
          loading={busy === `${plan}-annual`}
          disabled={!enabled || busy != null || !annual}
          onPress={() => void onPurchase(plan, "annual")}
          style={{ flex: 1 }}
        />
      </View>
      {annual?.pricePerMonth ? (
        <Text style={styles.annualEquivalent}>
          Annual equivalent: {annual.pricePerMonth} / month
        </Text>
      ) : null}
    </View>
  );
}

export function PlansPanel({ model }: { model: SettingsModel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { billingStatus, billingPackages, billingBusy, nativeBillingAvailable } = model;
  return (
    <>
      <View>
        <View style={styles.planTierFirst}>
          <View style={styles.headerRow}>
            <Text style={[styles.planName, { flex: 1 }]}>Basic</Text>
            {billingStatus?.plan === "basic" ? <BadgePill label="Current plan" /> : null}
          </View>
          <UIText variant="muted">
            Manual card creation, studying, and reviews stay available on Basic.
          </UIText>
        </View>
        <PlanTier
          plan="plus"
          creditAllowance="3,000 AI credits / month"
          description="More AI generation and study assistance for regular use."
          current={billingStatus?.plan === "plus"}
          packages={billingPackages}
          busy={billingBusy}
          enabled={nativeBillingAvailable}
          onPurchase={model.handlePurchase}
        />
        <PlanTier
          plan="pro"
          creditAllowance="8,000 AI credits / month"
          description="Higher AI limits for intensive study workflows."
          current={billingStatus?.plan === "pro"}
          packages={billingPackages}
          busy={billingBusy}
          enabled={nativeBillingAvailable}
          onPurchase={model.handlePurchase}
        />
      </View>
      {model.billingUnavailableReason ? (
        <Text style={styles.billingNotice}>{model.billingUnavailableReason}</Text>
      ) : null}
    </>
  );
}

export const BILLING_FOOTNOTE =
  "Payment is charged to your store account when you confirm your purchase. Subscriptions renew automatically unless canceled at least 24 hours before the current period ends. Manage or cancel your subscription in your store account settings.";

export function BillingFootnote() {
  return (
    <>
      <UIText variant="muted">{BILLING_FOOTNOTE}</UIText>
      <LegalLinks />
    </>
  );
}

export function DeleteAccountPanel({
  model,
  onCancel,
}: {
  model: SettingsModel;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, deleteText, setDeleteText, deletingAccount, deleteError } = model;
  return (
    <>
      <View>
        <Text style={styles.fieldLabel}>Type {user?.email ?? "your email"} to confirm</Text>
        <Field
          value={deleteText}
          onChangeText={setDeleteText}
          placeholder={user?.email ?? "you@example.com"}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          variant="secondary"
          size="md"
          label="Cancel"
          onPress={onCancel}
          disabled={deletingAccount}
          style={{ flex: 1 }}
        />
        <Button
          variant="danger"
          size="md"
          label={deletingAccount ? "Deleting…" : "Permanently delete"}
          loading={deletingAccount}
          disabled={
            deletingAccount ||
            deleteText.trim().toLowerCase() !== (user?.email ?? "").toLowerCase()
          }
          onPress={() => void model.handleDeleteAccount()}
          style={{ flex: 1 }}
        />
      </View>
      {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    rowDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    planTierFirst: {
      gap: 8,
      paddingBottom: 14,
    },
    planTier: {
      gap: 8,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    planName: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    planCredits: {
      color: colors.fgTertiary,
      fontSize: 13,
      lineHeight: 18,
    },
    billingActions: {
      flexDirection: "row",
      gap: 8,
    },
    annualEquivalent: {
      color: colors.fgTertiary,
      fontSize: 12,
      lineHeight: 16,
      textAlign: "right",
    },
    billingNotice: {
      color: colors.fgSecondary,
      backgroundColor: colors.bgSunken,
      borderRadius: radius.xl,
      overflow: "hidden",
      padding: 11,
      fontSize: 13,
      lineHeight: 19,
    },
    errorText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgError,
      fontWeight: "500",
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    fieldHint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.fgTertiary,
      marginTop: 5,
    },
    schoolName: {
      color: colors.fgPrimary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
    },
    unverifiedText: {
      color: colors.fgTertiary,
      fontWeight: "400",
    },
    searchSpinner: {
      position: "absolute",
      right: 14,
      top: 34,
    },
    universityResults: {
      overflow: "hidden",
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.xl,
      backgroundColor: colors.bgSurface,
    },
    universityOption: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 2,
    },
    universityOptionPressed: {
      backgroundColor: colors.bgHover,
    },
    universityOptionName: {
      color: colors.fgPrimary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
    },
    universityOptionMeta: {
      color: colors.fgTertiary,
      fontSize: 12,
      lineHeight: 16,
    },
    fontSample: {
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 18,
      borderRadius: radius.xl2,
      backgroundColor: colors.bgSunken,
    },
    fontSampleText: {
      fontSize: 18,
      lineHeight: 26,
      color: colors.fgPrimary,
      textAlign: "center",
    },
  });
}
