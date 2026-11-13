import { EasyDaysSettings } from "@/components/easy-days-settings";
import { RetentionSlider } from "@/components/retention-slider";
import { ReviewOrderControls } from "@/components/review-order-controls";
import { OfflineLibrarySettings } from "@/components/offline-library";
import {
  BillingFootnote,
  CardFontSample,
  DeleteAccountPanel,
  PlansPanel,
  ProfilePanel,
  UniversityPanel,
  formatBillingStatus,
  formatRelative,
  formatShortDate,
} from "@/components/settings/settings-panels";
import { SettingsForm } from "@/components/settings/settings-form";
import {
  FSRS_TARGET,
  useSettingsModel,
} from "@/components/settings/use-settings-model";
import { Redirect } from "expo-router";
import { useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "@/components/ui/avatar";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { ScreenHeader } from "@/components/ui/screen-header";
import { goBackOrReplace } from "@/lib/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { UIText } from "@/components/ui/text";
import { ProgressBar } from "@/components/ui/progress-bar";
import { haptics } from "@/lib/haptics";
import { CARD_FONT_OPTIONS, setCardFont } from "@/lib/study/card-font";
import { NEW_CARDS_PER_DAY_MAX } from "@/lib/study/retention";
import { darkColors, lightColors, midnightColors, radius } from "@/lib/theme";
import type { ThemeColors, ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  palettes: readonly ThemeColors[];
}> = [
  { value: "light", label: "Light", palettes: [lightColors] },
  { value: "dark", label: "Dark", palettes: [darkColors] },
  { value: "midnight", label: "Midnight", palettes: [midnightColors] },
  { value: "system", label: "System", palettes: [lightColors, darkColors] },
];

export default function ProfileScreen() {
  const model = useSettingsModel();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    user,
    signOut,
    name,
    email,
    initials,
    loading,
    stats,
    totalCards,
    preference,
    setPreference,
    cardFont,
    retentionPct,
    setRetentionPct,
    newCardsPerDay,
    setNewCardsPerDay,
    dayStartHour,
    setDayStartHour,
    reviewOrder,
    setReviewOrder,
    easyDays,
    setEasyDays,
    savingFsrs,
    globalFsrsDirty,
    fsrsSaveError,
    fsrsLogCount,
    fsrsProgress,
    optimizerReady,
    optimizing,
    optimizeError,
    lastOptimizedAt,
    billingStatus,
    billingLoading,
    billingBusy,
    billingMessage,
    billingError,
    creditUsage,
    nativeBillingAvailable,
    profile,
    refreshing,
    setRefreshing,
    load,
    loadBilling,
    deleteConfirming,
    setDeleteConfirming,
    setDeleteText,
    setDeleteError,
  } = model;

  // This screen lives outside the (app) group, so it needs its own auth guard.
  if (!user) {
    return <Redirect href="/" />;
  }

  if (Platform.OS === "ios") {
    return (
      <View style={styles.root}>
        {/* A sheet on iOS, so it closes rather than going back. */}
        <ScreenHeader
          title="Settings"
          backFallback="/home"
          actions={[
            {
              icon: "close",
              sfIcon: "xmark",
              label: "Close",
              placement: "left",
              onPress: () => goBackOrReplace("/home"),
            },
          ]}
        />
        <SettingsForm model={model} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Settings" backFallback="/home" />
      <KeyboardScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void Promise.allSettled([load(), loadBilling(false)]).finally(() =>
                setRefreshing(false),
              );
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.identity}>
          <Avatar initials={initials} size="lg" />
          <UIText variant="title" style={styles.rowCopy}>
            {name}
          </UIText>
        </View>
        <View style={[styles.row, styles.rowDivider]}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {email}
            </Text>
            {user?.created_at && (
              <Text style={styles.rowHint}>
                Member since{" "}
                {new Date(user.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            )}
          </View>
          <Button
            variant="secondary"
            size="sm"
            label="Sign out"
            onPress={() => void signOut()}
          />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
        ) : (
          stats && (
            <View style={styles.statGrid}>
              <StatTile value={String(totalCards)} label="Total cards" />
              <StatTile
                value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
                label="Current streak"
              />
              <StatTile value={String(stats.reviewed_today)} label="Reviews today" />
              <StatTile
                value={
                  stats.retention_pct != null
                    ? `${Math.round(stats.retention_pct * 100)}%`
                    : "None yet"
                }
                label="30-day retention"
              />
            </View>
          )
        )}

        <Section title="Profile">
          <ProfilePanel model={model} />
        </Section>

        <Section title="Appearance">
          <UIText variant="muted">
            Choose how DeepHaus looks. Match your system or pick a fixed theme.
          </UIText>
          <View style={styles.themeGrid}>
            {THEME_OPTIONS.map((option) => {
              const active = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  onPress={() => {
                    haptics.selection();
                    setPreference(option.value);
                  }}
                  style={styles.themeCell}
                >
                  <View style={[styles.themeThumb, active && styles.themeThumbActive]}>
                    {option.palettes.map((palette, index) => (
                      <ThemeThumbPane key={index} palette={palette} rail={index === 0} />
                    ))}
                  </View>
                  <Text style={[styles.themeLabel, active && styles.themeLabelActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.groupLabel}>Card font</Text>
          <SegmentedControl
            options={CARD_FONT_OPTIONS}
            value={cardFont}
            onChange={setCardFont}
            accessibilityLabel="Card font"
          />
          <CardFontSample cardFont={cardFont} />
        </Section>

        <Section title="Study defaults">
          <UIText variant="muted">
            Default retention and new-card limits for new decks and decks that inherit global settings.
          </UIText>
          <View style={styles.rowGroup}>
            <RetentionSlider value={retentionPct} onChange={setRetentionPct} />
            <NumberRow
              label="New cards per day"
              value={String(newCardsPerDay)}
              onChangeText={(text) => {
                const n = Number(text.replace(/[^\d]/g, ""));
                if (!Number.isFinite(n)) return;
                setNewCardsPerDay(Math.max(0, Math.min(NEW_CARDS_PER_DAY_MAX, n)));
              }}
              placeholder="10"
            />
            <NumberRow
              label={`Day starts at ${dayStartHour === 0 ? "midnight" : `${dayStartHour}:00`}`}
              hint="Reviews before this hour count toward the previous study day (0–23)."
              value={String(dayStartHour)}
              onChangeText={(text) => {
                const n = Number(text.replace(/[^\d]/g, ""));
                if (!Number.isFinite(n)) return;
                setDayStartHour(Math.max(0, Math.min(23, n)));
              }}
              placeholder="4"
            />
          </View>
          <EasyDaysSettings value={easyDays} onChange={setEasyDays} disabled={savingFsrs} />
          <Text style={styles.groupLabel}>Review order</Text>
          <View style={styles.rowGroup}>
            <ReviewOrderControls value={reviewOrder} onChange={setReviewOrder} />
          </View>
          {globalFsrsDirty ? (
            <Button
              variant="primary"
              size="md"
              label={savingFsrs ? "Saving…" : "Save global defaults"}
              loading={savingFsrs}
              disabled={savingFsrs || !easyDays.includes("normal")}
              onPress={() => void model.handleSaveGlobalFsrs()}
              fullWidth
            />
          ) : null}
          {fsrsSaveError ? <Text style={styles.errorText}>{fsrsSaveError}</Text> : null}
        </Section>

        <Section title="Adaptive learning">
          <UIText variant="muted">
            DeepHaus uses the FSRS-7 algorithm to schedule reviews. Once you've
            graded enough cards, the scheduler can be tuned to your memory.
          </UIText>
          <ProgressBar value={fsrsProgress / FSRS_TARGET} />
          <View style={styles.fsrsRow}>
            <Text style={styles.fsrsCount}>
              <Text style={styles.fsrsCountStrong}>{fsrsLogCount}</Text>
              <Text> / {FSRS_TARGET} reviews logged</Text>
            </Text>
            <Text style={styles.fsrsRemaining}>
              {optimizerReady
                ? "Ready to optimize"
                : `${Math.max(0, FSRS_TARGET - fsrsLogCount)} more to unlock`}
            </Text>
          </View>
          <Button
            variant="secondary"
            size="md"
            label={optimizing ? "Optimizing…" : lastOptimizedAt ? "Re-optimize" : "Optimize FSRS"}
            leadingIcon="equalizer"
            loading={optimizing}
            disabled={!optimizerReady || optimizing}
            onPress={() => void model.handleOptimize()}
            style={{ opacity: optimizerReady ? 1 : 0.7 }}
            fullWidth
          />
          {optimizeError ? (
            <Text style={styles.errorText}>{optimizeError}</Text>
          ) : lastOptimizedAt ? (
            <Text style={styles.fsrsRemaining}>Last optimized {formatRelative(lastOptimizedAt)}</Text>
          ) : null}
        </Section>

        <Section title="Usage & billing">
          <UIText variant="muted">
            Store prices are shown in your local currency.
          </UIText>
          {billingStatus ? (
            <View>
              <Text style={styles.planName}>{billingStatus.planName}</Text>
              <UIText variant="muted">
                Subscription status: {formatBillingStatus(billingStatus.status)}
                {billingStatus.willRenew ? " · renews automatically" : ""}
              </UIText>
            </View>
          ) : null}

          {billingLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              {billingStatus ? (
                <View style={{ gap: 7 }}>
                  <View style={styles.creditRow}>
                    <Text style={styles.creditLabel}>Monthly AI credits</Text>
                    <Text style={styles.creditValue}>
                      {billingStatus.credits.used + billingStatus.credits.reserved} of{" "}
                      {billingStatus.credits.allowance} used
                    </Text>
                  </View>
                  <ProgressBar
                    value={
                      billingStatus.credits.allowance > 0
                        ? creditUsage / billingStatus.credits.allowance
                        : 0
                    }
                  />
                  <Text style={styles.fieldHint}>
                    {billingStatus.credits.remaining} remaining
                    {billingStatus.credits.reserved > 0
                      ? ` · ${billingStatus.credits.reserved} pending`
                      : ""}
                    {billingStatus.credits.periodEnd
                      ? ` · resets ${formatShortDate(billingStatus.credits.periodEnd)}`
                      : ""}
                  </Text>
                </View>
              ) : null}

              <PlansPanel model={model} />

              <View style={styles.billingActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  label={billingBusy === "restore" ? "Restoring…" : "Restore purchases"}
                  loading={billingBusy === "restore"}
                  disabled={!nativeBillingAvailable || billingBusy != null}
                  onPress={() => void model.handleRestoreBilling()}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  label="Manage subscription"
                  loading={billingBusy === "manage"}
                  disabled={!nativeBillingAvailable || billingBusy != null}
                  onPress={() => void model.handleManageBilling()}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}

          {billingMessage ? <Text style={styles.billingSuccess}>{billingMessage}</Text> : null}
          {billingError ? <Text style={styles.errorText}>{billingError}</Text> : null}
          <BillingFootnote />
        </Section>

        <Section
          title="University"
          accessory={
            profile?.university_email_verified_at ? <BadgePill label="Verified" /> : null
          }
        >
          <UniversityPanel model={model} />
        </Section>

        <OfflineLibrarySettings />

        <Section title="Delete account">
          <UIText variant="muted">
            Permanently delete your account, decks, cards, review history, and uploaded
            files. This cannot be undone. App Store, Google Play, and Stripe subscriptions
            must be cancelled separately or they may continue renewing.
          </UIText>
          {deleteConfirming ? (
            <DeleteAccountPanel
              model={model}
              onCancel={() => {
                setDeleteConfirming(false);
                setDeleteText("");
                setDeleteError(null);
              }}
            />
          ) : (
            <Button
              variant="secondary"
              size="md"
              label="Delete account…"
              textStyle={{ color: colors.fgError }}
              onPress={() => {
                haptics.warning();
                setDeleteConfirming(true);
              }}
              fullWidth
            />
          )}
        </Section>

        <Text style={styles.version}>DeepHaus mobile · v1.0.0</Text>
      </ScrollView>
      </KeyboardScreen>
    </View>
  );
}

function Section({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <UIText variant="subtitle" accessibilityRole="header" style={styles.rowCopy}>
          {title}
        </UIText>
        {accessory}
      </View>
      {children}
    </View>
  );
}

function NumberRow({
  label,
  hint,
  suffix,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  hint?: string;
  suffix?: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.row, styles.rowDivider]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Field
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        placeholder={placeholder}
        containerStyle={styles.numberField}
        inputStyle={styles.numberInput}
        trailing={suffix ? <Text style={styles.numberSuffix}>{suffix}</Text> : undefined}
      />
    </View>
  );
}

function ThemeThumbPane({ palette, rail }: { palette: ThemeColors; rail: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.thumbPane, { backgroundColor: palette.bgCanvas }]}>
      {rail ? <View style={[styles.thumbRail, { backgroundColor: palette.bgRail }]} /> : null}
      <View style={styles.thumbBody}>
        <View style={[styles.thumbBar, { backgroundColor: palette.fgPrimary }]} />
        <View
          style={[
            styles.thumbInput,
            { backgroundColor: palette.bgSurface, borderColor: palette.lineStrong },
          ]}
        />
      </View>
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 12,
    },
    section: {
      gap: 14,
      paddingVertical: 24,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      minHeight: 52,
      paddingVertical: 10,
    },
    rowDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    rowGroup: {
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      fontSize: 15,
      lineHeight: 20,
      color: colors.fgPrimary,
    },
    rowHint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      marginTop: 1,
    },
    groupLabel: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
      marginTop: 8,
    },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    statTile: {
      width: "50%",
      paddingVertical: 8,
    },
    statValue: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    statLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    planName: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    creditRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    creditLabel: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    creditValue: {
      color: colors.fgPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
    },
    billingActions: {
      flexDirection: "row",
      gap: 8,
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
    billingSuccess: {
      color: colors.accentInk,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
    },
    fsrsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    fsrsCount: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    fsrsCountStrong: {
      color: colors.fgPrimary,
      fontWeight: "500",
    },
    fsrsRemaining: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
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
    numberField: {
      width: 84,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    numberInput: {
      textAlign: "right",
    },
    numberSuffix: {
      fontSize: 15,
      color: colors.fgTertiary,
    },
    themeGrid: {
      flexDirection: "row",
      gap: 8,
    },
    themeCell: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      gap: 6,
    },
    themeThumb: {
      alignSelf: "stretch",
      flexDirection: "row",
      height: 60,
      borderRadius: radius.xl2,
      borderColor: colors.line,
      borderWidth: 1,
      overflow: "hidden",
    },
    themeThumbActive: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    thumbPane: {
      flex: 1,
      flexDirection: "row",
    },
    thumbRail: {
      width: 14,
    },
    thumbBody: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    thumbBar: {
      width: "60%",
      height: 3,
      borderRadius: 2,
    },
    thumbInput: {
      width: "72%",
      height: 11,
      borderRadius: 3,
      borderWidth: 1,
    },
    themeLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
    },
    themeLabelActive: {
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    version: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
      textAlign: "center",
      paddingVertical: 8,
    },
  });
}
