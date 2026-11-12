import {
  Button,
  Form,
  HStack,
  Host,
  Image,
  LabeledContent,
  Picker,
  ProgressView,
  RNHostView,
  Section,
  Spacer,
  Stepper,
  Text,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  pickerStyle,
  progressViewStyle,
  refreshable,
  scrollContentBackground,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { weekendWarriorDays } from "@deephaus/shared";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { EasyDaysSettings } from "@/components/easy-days-settings";
import { REVIEW_ORDER_FOOTNOTE, ReviewOrderRows } from "@/components/settings/review-order-rows";
import { useOfflineLibrary } from "@/components/offline-library";
import {
  BILLING_FOOTNOTE,
  CardFontSample,
  DeleteAccountPanel,
  PlansPanel,
  ProfilePanel,
  UniversityPanel,
  formatBillingStatus,
  formatRelative,
  formatShortDate,
} from "@/components/settings/settings-panels";
import { FSRS_TARGET, type SettingsModel } from "@/components/settings/use-settings-model";
import { Avatar } from "@/components/ui/avatar";
import { NativeSheet } from "@/components/ui/native-sheet";
import { UIText } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { CARD_FONT_OPTIONS, setCardFont } from "@/lib/study/card-font";
import type { ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "midnight", label: "Midnight" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const LEGAL_LINKS = [
  { label: "Privacy policy", url: "https://www.deephaus.ai/privacy" },
  { label: "Terms of use", url: "https://www.deephaus.ai/terms" },
] as const;

type SheetKey = "profile" | "easyDays" | "plans" | "university" | "delete";

function sentenceCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function hourLabel(hour: number) {
  return hour === 0 ? "Midnight" : `${hour}:00`;
}

function easyDaysLabel(value: SettingsModel["easyDays"]) {
  if (value.every((day) => day === "normal")) return "Normal week";
  if (JSON.stringify(value) === JSON.stringify(weekendWarriorDays())) return "Weekend warrior";
  return "Custom";
}

async function openPage(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Alert.alert("Unable to open page", `Please visit ${url} in your browser.`);
  }
}

/** iOS Settings: a native grouped form. Text entry happens in native sheets. */
export function SettingsForm({ model }: { model: SettingsModel }) {
  const { colors, colorScheme } = useTheme();
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const {
    stats,
    loading,
    name,
    email,
    user,
    profile,
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
    savingFsrs,
    globalFsrsDirty,
    fsrsSaveError,
    totalCards,
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
    billingUnavailableReason,
    creditUsage,
    nativeBillingAvailable,
  } = model;

  const row = useMemo(() => [listRowBackground(colors.bgSurface)], [colors]);
  const muted = useMemo(() => [foregroundStyle(colors.fgTertiary)], [colors]);
  const value = useMemo(() => [foregroundStyle(colors.fgTertiary), lineLimit(1)], [colors]);
  const primary = useMemo(() => [foregroundStyle(colors.fgPrimary)], [colors]);
  const footnote = useMemo(
    () => [font({ size: 13 }), foregroundStyle(colors.fgTertiary)],
    [colors],
  );

  const navRow = (title: string, detail: string | undefined, onPress: () => void) => (
    <Button onPress={onPress}>
      <HStack spacing={8}>
        <Text modifiers={primary}>{title}</Text>
        <Spacer />
        {detail ? <Text modifiers={value}>{detail}</Text> : null}
        <Image systemName="chevron.right" size={13} color={colors.fgQuaternary} />
      </HStack>
    </Button>
  );

  const labeled = (label: string, detail: string) => (
    <LabeledContent label={label}>
      <Text modifiers={value}>{detail}</Text>
    </LabeledContent>
  );

  return (
    <>
      <Host style={{ flex: 1 }} colorScheme={colorScheme} seedColor={colors.accent}>
        <Form
          modifiers={[
            scrollContentBackground("hidden"),
            background(colors.bgCanvas),
            refreshable(async () => {
              await Promise.allSettled([model.load(), model.loadBilling(false)]);
            }),
          ]}
        >
          <Section modifiers={row}>
            <Button onPress={() => setSheet("profile")}>
              <HStack spacing={12}>
                <RNHostView matchContents>
                  <View>
                    <Avatar initials={model.initials} size="md" />
                  </View>
                </RNHostView>
                <VStack alignment="leading" spacing={1}>
                  <Text modifiers={[font({ size: 17, weight: "semibold" }), ...primary]}>
                    {String(name)}
                  </Text>
                  <Text modifiers={[font({ size: 14 }), ...value]}>{email}</Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" size={13} color={colors.fgQuaternary} />
              </HStack>
            </Button>
            {user?.created_at
              ? labeled(
                  "Member since",
                  new Date(user.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    year: "numeric",
                  }),
                )
              : null}
          </Section>

          {loading ? (
            <Section modifiers={row}>
              <ProgressView />
            </Section>
          ) : stats ? (
            <Section title="Overview" modifiers={row}>
              {labeled("Total cards", totalCards.toLocaleString())}
              {labeled(
                "Current streak",
                `${stats.streak} ${stats.streak === 1 ? "day" : "days"}`,
              )}
              {labeled("Reviews today", stats.reviewed_today.toLocaleString())}
              {labeled(
                "30-day retention",
                stats.retention_pct != null
                  ? `${Math.round(stats.retention_pct * 100)}%`
                  : "None yet",
              )}
            </Section>
          ) : null}

          <Section title="Appearance" modifiers={row}>
            <Picker
              label="Theme"
              selection={preference}
              onSelectionChange={(next: ThemePreference) => {
                haptics.selection();
                setPreference(next);
              }}
              modifiers={[pickerStyle("menu"), tint(colors.fgTertiary)]}
            >
              {THEME_OPTIONS.map((option) => (
                <Text key={option.value} modifiers={[tag(option.value)]}>
                  {option.label}
                </Text>
              ))}
            </Picker>
            <Picker
              label="Card font"
              selection={cardFont}
              onSelectionChange={(next: typeof cardFont) => {
                haptics.selection();
                setCardFont(next);
              }}
              modifiers={[pickerStyle("menu"), tint(colors.fgTertiary)]}
            >
              {CARD_FONT_OPTIONS.map((option) => (
                <Text key={option.value} modifiers={[tag(option.value)]}>
                  {option.label}
                </Text>
              ))}
            </Picker>
            <RNHostView matchContents={{ vertical: true }}>
              <View>
                <CardFontSample cardFont={cardFont} />
              </View>
            </RNHostView>
          </Section>

          <Section
            title="Study defaults"
            modifiers={row}
            footer={
              <Text modifiers={footnote}>
                For new decks and decks that inherit global settings. Reviews before the day start
                count toward the previous study day.
              </Text>
            }
          >
            <Stepper
              label={`Desired retention: ${retentionPct}%`}
              value={retentionPct}
              min={70}
              max={97}
              onValueChange={setRetentionPct}
            />
            <Stepper
              label={`New cards per day: ${newCardsPerDay}`}
              value={newCardsPerDay}
              min={0}
              max={200}
              onValueChange={setNewCardsPerDay}
            />
            <Picker
              label="Day starts at"
              selection={dayStartHour}
              onSelectionChange={(hour: number) => setDayStartHour(hour)}
              modifiers={[pickerStyle("menu"), tint(colors.fgTertiary)]}
            >
              {HOURS.map((hour) => (
                <Text key={hour} modifiers={[tag(hour)]}>
                  {hourLabel(hour)}
                </Text>
              ))}
            </Picker>
            {navRow("Easy days", easyDaysLabel(easyDays), () => setSheet("easyDays"))}
          </Section>

          <Section
            title="Review order"
            modifiers={row}
            footer={<Text modifiers={footnote}>{REVIEW_ORDER_FOOTNOTE}</Text>}
          >
            <ReviewOrderRows value={reviewOrder} onChange={setReviewOrder} />
            {globalFsrsDirty ? (
              <Button
                label={savingFsrs ? "Saving…" : "Save global defaults"}
                modifiers={[
                  disabled(savingFsrs || !easyDays.includes("normal")),
                  tint(colors.accentInk),
                ]}
                onPress={() => void model.handleSaveGlobalFsrs()}
              />
            ) : null}
            {fsrsSaveError ? (
              <Text modifiers={[foregroundStyle(colors.fgError)]}>{fsrsSaveError}</Text>
            ) : null}
          </Section>

          <Section
            title="Adaptive learning"
            modifiers={row}
            footer={
              <Text modifiers={footnote}>
                DeepHaus uses the FSRS-7 algorithm to schedule reviews. Once you've graded enough
                cards, the scheduler can be tuned to your memory.
              </Text>
            }
          >
            <VStack alignment="leading" spacing={8}>
              <ProgressView
                value={fsrsProgress / FSRS_TARGET}
                modifiers={[progressViewStyle("linear"), tint(colors.accent)]}
              />
              <HStack>
                <Text modifiers={[font({ size: 13 }), ...muted]}>
                  {`${fsrsLogCount} / ${FSRS_TARGET} reviews logged`}
                </Text>
                <Spacer />
                <Text modifiers={[font({ size: 13 }), ...muted]}>
                  {optimizerReady
                    ? "Ready to optimize"
                    : `${Math.max(0, FSRS_TARGET - fsrsLogCount)} more to unlock`}
                </Text>
              </HStack>
            </VStack>
            <Button
              label={optimizing ? "Optimizing…" : lastOptimizedAt ? "Re-optimize" : "Optimize FSRS"}
              modifiers={[disabled(!optimizerReady || optimizing), tint(colors.accentInk)]}
              onPress={() => void model.handleOptimize()}
            />
            {optimizeError ? (
              <Text modifiers={[foregroundStyle(colors.fgError)]}>{optimizeError}</Text>
            ) : lastOptimizedAt ? (
              labeled("Last optimized", formatRelative(lastOptimizedAt))
            ) : null}
          </Section>

          <Section
            title="Usage and billing"
            modifiers={row}
            footer={<Text modifiers={footnote}>{BILLING_FOOTNOTE}</Text>}
          >
            {billingStatus ? (
              <>
                {labeled("Plan", billingStatus.planName)}
                {labeled(
                  "Status",
                  `${sentenceCase(formatBillingStatus(billingStatus.status))}${
                    billingStatus.willRenew ? ", renews automatically" : ""
                  }`,
                )}
              </>
            ) : null}
            {billingLoading ? (
              <ProgressView />
            ) : (
              <>
                {billingStatus ? (
                  <VStack alignment="leading" spacing={8}>
                    <HStack>
                      <Text modifiers={primary}>Monthly AI credits</Text>
                      <Spacer />
                      <Text modifiers={value}>
                        {`${
                          billingStatus.credits.used + billingStatus.credits.reserved
                        } of ${billingStatus.credits.allowance} used`}
                      </Text>
                    </HStack>
                    <ProgressView
                      value={
                        billingStatus.credits.allowance > 0
                          ? creditUsage / billingStatus.credits.allowance
                          : 0
                      }
                      modifiers={[progressViewStyle("linear"), tint(colors.accent)]}
                    />
                    <Text modifiers={[font({ size: 13 }), ...muted]}>
                      {[
                        `${billingStatus.credits.remaining} remaining`,
                        billingStatus.credits.reserved > 0
                          ? `${billingStatus.credits.reserved} pending`
                          : null,
                        billingStatus.credits.periodEnd
                          ? `resets ${formatShortDate(billingStatus.credits.periodEnd)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </VStack>
                ) : null}
                {navRow("Plans", undefined, () => setSheet("plans"))}
                <Button
                  label={billingBusy === "restore" ? "Restoring…" : "Restore purchases"}
                  modifiers={[
                    disabled(!nativeBillingAvailable || billingBusy != null),
                    tint(colors.accentInk),
                  ]}
                  onPress={() => void model.handleRestoreBilling()}
                />
                <Button
                  label="Manage subscription"
                  modifiers={[
                    disabled(!nativeBillingAvailable || billingBusy != null),
                    tint(colors.accentInk),
                  ]}
                  onPress={() => void model.handleManageBilling()}
                />
              </>
            )}
            {billingUnavailableReason ? (
              <Text modifiers={[font({ size: 13 }), ...muted]}>{billingUnavailableReason}</Text>
            ) : null}
            {billingMessage ? (
              <Text modifiers={[foregroundStyle(colors.accentInk)]}>{billingMessage}</Text>
            ) : null}
            {billingError ? (
              <Text modifiers={[foregroundStyle(colors.fgError)]}>{billingError}</Text>
            ) : null}
            {LEGAL_LINKS.map((link) => (
              <Button
                key={link.url}
                label={link.label}
                modifiers={[tint(colors.accentInk)]}
                onPress={() => void openPage(link.url)}
              />
            ))}
          </Section>

          <Section title="University" modifiers={row}>
            {navRow(
              "University",
              profile?.university_name
                ? `${profile.university_name}${
                    profile.university_email_verified_at ? "" : ", unverified"
                  }`
                : "Not set",
              () => setSheet("university"),
            )}
          </Section>

          <OfflineSection row={row} muted={muted} value={value} footnote={footnote} />

          <Section
            modifiers={row}
            footer={<Text modifiers={footnote}>DeepHaus mobile · v1.0.0</Text>}
          >
            <Button
              label="Sign out"
              modifiers={[tint(colors.fgPrimary)]}
              onPress={() => void model.signOut()}
            />
            <Button
              label="Delete account…"
              role="destructive"
              onPress={() => {
                haptics.warning();
                setSheet("delete");
              }}
            />
          </Section>

        </Form>
      </Host>

      <NativeSheet
        visible={sheet === "profile"}
        onClose={() => setSheet(null)}
        title="Profile"
        detents={[{ height: 340 }, "large"]}
      >
        <SheetBody>
          <ProfilePanel model={model} />
        </SheetBody>
      </NativeSheet>
      <NativeSheet
        visible={sheet === "easyDays"}
        onClose={() => setSheet(null)}
        title="Easy days"
        detents={["large"]}
      >
        <SheetBody>
          <EasyDaysSettings value={easyDays} onChange={model.setEasyDays} disabled={savingFsrs} />
        </SheetBody>
      </NativeSheet>
      <NativeSheet
        visible={sheet === "plans"}
        onClose={() => setSheet(null)}
        title="Plans"
        detents={["large"]}
      >
        <SheetBody>
          <PlansPanel model={model} />
        </SheetBody>
      </NativeSheet>
      <NativeSheet
        visible={sheet === "university"}
        onClose={() => setSheet(null)}
        title="University"
        detents={["large"]}
      >
        <SheetBody>
          <UniversityPanel model={model} />
        </SheetBody>
      </NativeSheet>
      <NativeSheet
        visible={sheet === "delete"}
        onClose={() => {
          model.setDeleteText("");
          model.setDeleteConfirming(false);
          setSheet(null);
        }}
        title="Delete account"
        detents={["large"]}
        dismissDisabled={model.deletingAccount}
      >
        <SheetBody>
          <UIText variant="muted">
            Permanently delete your account, decks, cards, review history, and uploaded files. This
            cannot be undone. App Store, Google Play, and Stripe subscriptions must be cancelled
            separately or they may continue renewing.
          </UIText>
          <DeleteAccountPanel
            model={model}
            onCancel={() => {
              model.setDeleteText("");
              setSheet(null);
            }}
          />
        </SheetBody>
      </NativeSheet>
    </>
  );
}

function SheetBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.sheetBody}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
}

function OfflineSection({
  row,
  muted,
  value,
  footnote,
}: {
  row: ReturnType<typeof listRowBackground>[];
  muted: ReturnType<typeof foregroundStyle>[];
  value: ReturnType<typeof foregroundStyle>[];
  footnote: ReturnType<typeof foregroundStyle>[];
}) {
  const library = useOfflineLibrary();
  const { colors } = useTheme();
  if (!library) return null;
  const { state, pending, uploadError, paused, cellular, togglePaused, setCellular, retry } =
    library;
  const label = paused
    ? "Downloads paused"
    : state?.state === "Ready offline"
      ? "Downloaded"
      : (state?.state ?? "Checking downloads…");
  return (
    <Section
      title="Offline downloads"
      modifiers={row}
      footer={
        <Text modifiers={footnote}>
          Keep card images and audio on this device for studying without a connection.
        </Text>
      }
    >
      <LabeledContent label="Status">
        <Text modifiers={value}>{label}</Text>
      </LabeledContent>
      <LabeledContent label="On this device">
        <Text modifiers={value}>
          {`${state?.downloaded ?? 0}/${state?.total ?? 0} files · ${(
            (state?.bytes ?? 0) / 1048576
          ).toFixed(1)} MB`}
        </Text>
      </LabeledContent>
      <LabeledContent label="Sync">
        <Text modifiers={value}>
          {pending === 0 ? "All changes synced" : `${pending} changes waiting`}
        </Text>
      </LabeledContent>
      {state?.error ? (
        <Text modifiers={[foregroundStyle(colors.fgError)]}>{state.error}</Text>
      ) : null}
      {uploadError ? (
        <Text modifiers={muted}>Your changes are saved on this device. Sign in again to sync.</Text>
      ) : null}
      <Toggle
        label="Use cellular data"
        isOn={cellular}
        onIsOnChange={setCellular}
        modifiers={[tint(colors.accent)]}
      />
      <Button
        label={paused ? "Resume downloads" : "Pause downloads"}
        modifiers={[disabled(!state), tint(colors.accentInk)]}
        onPress={togglePaused}
      />
      <Button
        label="Check downloads"
        modifiers={[disabled(!state), tint(colors.accentInk)]}
        onPress={retry}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  sheetBody: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 14 },
});
