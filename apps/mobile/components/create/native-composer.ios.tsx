import {
  Button,
  Capsule,
  GlassEffectContainer,
  HStack,
  Host,
  Menu,
  ProgressView,
  Spacer,
  Text as SwiftText,
  TextField,
  type TextFieldRef,
  VStack,
} from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityHidden,
  accessibilityLabel,
  animation,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  layoutPriority,
  lineLimit,
  menuIndicator,
  menuOrder,
  monospacedDigit,
  onTapGesture,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { CardOptionsMenu } from "@/components/create/card-options-menu.ios";
import { COMPOSER_BUTTON, CircleLabel, PillLabel } from "@/components/create/composer-buttons.ios";
import type { ComposerHandle, ComposerProps } from "@/components/create/composer-types";
import { Icon } from "@/components/ui/icon";
import { renderEntries } from "@/components/ui/native-menu.ios";
import {
  VOICE_LEVEL_HISTORY,
  appendTranscript,
  formatMillis,
  useVoicePrompt,
  type VoicePromptStatus,
} from "@/hooks/use-voice-prompt";
import { composerTouchGuard } from "@/lib/composer-touch-guard";
import { truncateTitle } from "@/lib/create-input";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * Longest deck name shown in the composer's deck button. The button keeps its
 * full width (a glass menu squeezed by SwiftUI shows only "…"), so a longer
 * name is shortened here; at this length the row fits a 375-point phone.
 */
const DECK_LABEL_CHARS = 11;

/** SwiftUI's stand-in for double.infinity: wider than any screen. */
const FILL = 100_000;
/** The row's modes, numbered for SwiftUI's animation value. */
const MODES: VoicePromptStatus[] = ["idle", "recording", "transcribing"];
const BAR_WIDTH = 3;
const BAR_GAP = 3;
const BAR_MAX = 22;
/**
 * Everything in the recording row but the waveform: the dock's and panel's
 * gutters, cancel, the timer, stop, send and the gaps between them.
 */
const RECORDING_ROW_CHROME = 24 + 20 + COMPOSER_BUTTON * 3 + 30 + 8 * 4;

/**
 * The live mic level as Claude draws it: a dotted line, newest on the right,
 * where each dot stretches into a bar with the voice, older readings moving
 * left and dropping off the end.
 */
function VoiceWaveform({
  levels,
  color,
  bars,
}: {
  levels: number[];
  color: string;
  /** How many bars fill the row on this phone. */
  bars: number;
}) {
  // The newest readings, padded with silence so the line spans the row from
  // the first moment.
  const recent = levels.slice(-bars);
  const padded = [...Array(Math.max(0, bars - recent.length)).fill(0), ...recent];
  return (
    <HStack
      spacing={BAR_GAP}
      alignment="center"
      modifiers={[
        // A fixed number of bars that fits any phone: the glass panel sizes
        // to its content, so a stretchy waveform pushed it off the screen.
        frame({ height: COMPOSER_BUTTON }),
        accessibilityHidden(true),
        animation(Animation.linear({ duration: 0.08 }), levels.length),
      ]}
    >
      {padded.map((level, index) => (
        <Capsule
          key={index}
          modifiers={[
            frame({ width: BAR_WIDTH, height: BAR_WIDTH + level * (BAR_MAX - BAR_WIDTH) }),
            foregroundStyle(color),
          ]}
        />
      ))}
    </HStack>
  );
}

/**
 * The composer as native SwiftUI, like the inputs in Claude's and ChatGPT's
 * apps: a text field that grows to six lines on one Liquid Glass panel, with
 * Claude-style buttons under it. With nothing typed the round button on the
 * right speaks the prompt; with text it sends. Speaking turns the row into a
 * recording bar (cancel, live waveform, stop, send).
 */
export const NativeComposer = forwardRef<ComposerHandle, ComposerProps>(function NativeComposer(
  {
    value,
    onChangeText,
    placeholder,
    hint,
    attachmentName,
    onRemoveAttachment,
    addEntries,
    deckLabel,
    deckEntries,
    onOptions,
    cardOptions,
    onSend,
    canSend,
    sending,
    onFocus,
    onBlur,
  },
  ref,
) {
  const { colors, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const field = useRef<TextFieldRef>(null);
  // The text the field last reported, so changes made by Home (clearing after
  // send, restoring a draft) are pushed in and the user's typing isn't echoed.
  // Starts empty so a draft that's already set (a retry) is pushed in on mount.
  const fieldText = useRef("");
  const valueRef = useRef(value);
  valueRef.current = value;
  // Send once a spoken prompt's text has reached Home (see the effect below).
  const sendWhenReady = useRef(false);
  const voice = useVoicePrompt((transcript, { send }) => {
    onChangeText(appendTranscript(valueRef.current, transcript));
    if (send) sendWhenReady.current = true;
  });
  const voiceFailed = voice.status === "idle" && Boolean(voice.error);
  // Recording and transcribing show in the row itself; above it, only a
  // failure or Home's hint.
  const statusText = voiceFailed ? voice.error : hint;
  const hasContent = value.trim().length > 0 || Boolean(attachmentName);
  // The waveform fills the row between the timer and stop: as many bars as fit.
  const { width: windowWidth } = useWindowDimensions();
  const waveformBars = Math.min(
    VOICE_LEVEL_HISTORY,
    Math.max(12, Math.floor((windowWidth - RECORDING_ROW_CHROME + BAR_GAP) / (BAR_WIDTH + BAR_GAP))),
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => void field.current?.focus(),
      blur: () => void field.current?.blur(),
    }),
    [],
  );

  useEffect(() => {
    if (value === fieldText.current) return;
    fieldText.current = value;
    void field.current?.setText(value);
  }, [value]);

  const sendDisabled = !canSend || Boolean(sending);

  // "Stop and make cards": Home's send reads its draft, so wait until the
  // transcript is in it before sending.
  useEffect(() => {
    if (!sendWhenReady.current || !value.trim()) return;
    sendWhenReady.current = false;
    if (canSend && !sending) onSend();
  }, [canSend, onSend, sending, value]);
  // The row's buttons draw their own Claude-style labels on the glass panel.
  const plain = [buttonStyle("plain"), menuIndicator("hidden")];

  return (
    <View style={styles.root}>
      {attachmentName ? (
        <View style={styles.attachment}>
          <Icon name="document" size={18} color={colors.fgSecondary} />
          <Text style={styles.attachmentName} numberOfLines={1}>
            {attachmentName}
          </Text>
          <Pressable
            onPress={onRemoveAttachment}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${attachmentName}`}
            style={styles.attachmentRemove}
          >
            <Icon name="close" size={14} color={colors.fgTertiary} />
          </Pressable>
        </View>
      ) : null}
      {statusText ? (
        <View
          style={[styles.hint, voiceFailed && styles.hintAlert]}
          accessibilityLiveRegion={voiceFailed ? "assertive" : "polite"}
        >
          <Text
            style={[styles.hintText, voiceFailed && styles.hintAlertText]}
            numberOfLines={voiceFailed ? 2 : 1}
          >
            {statusText}
          </Text>
        </View>
      ) : null}

      {/* A drag that starts on the glass stays with it rather than opening
          the sidebar (see composerTouchGuard). */}
      <GestureDetector gesture={composerTouchGuard}>
        <View collapsable={false} style={styles.host}>
          {/* Home lifts the composer onto the keyboard itself, frame by frame;
              SwiftUI's own keyboard avoidance would push it further. */}
          <Host
            matchContents={{ vertical: true }}
            ignoreSafeArea="keyboard"
            colorScheme={colorScheme}
            style={styles.host}
          >
            <GlassEffectContainer spacing={8}>
              <VStack
                alignment="leading"
                spacing={10}
                modifiers={[
                  frame({ maxWidth: FILL, alignment: "leading" }),
                  padding({ top: 14, leading: 10, trailing: 10, bottom: 10 }),
                  // Not interactive glass: with it, the +, deck and settings menus
                  // that open from this panel took no taps, so no choice in them
                  // (a card type, New deck, Import) ever reached the app.
                  glassEffect({
                    glass: { variant: "regular" },
                    shape: "roundedRectangle",
                    cornerRadius: 26,
                  }),
                  // A tap anywhere on the panel that isn't a button starts typing,
                  // as in Claude: a SwiftUI text field only takes taps on its text,
                  // so the empty space under the placeholder and between the
                  // buttons did nothing. The buttons and the field keep their own taps.
                  contentShape(shapes.roundedRectangle({ cornerRadius: 26 })),
                  onTapGesture(() => void field.current?.focus()),
                ]}
              >
                <TextField
                  ref={field}
                  axis="vertical"
                  placeholder={placeholder}
                  onTextChange={(text) => {
                    fieldText.current = text;
                    voice.clearError();
                    onChangeText(text);
                  }}
                  onFocusChange={(focused) => (focused ? onFocus?.() : onBlur?.())}
                  modifiers={[
                    lineLimit({ min: 1, max: 6 }),
                    font({ size: 17 }),
                    padding({ horizontal: 8 }),
                    frame({ maxWidth: FILL, minHeight: 44, alignment: "topLeading" }),
                  ]}
                />
                {/* One row that changes with the voice prompt, as in Claude's
                    composer: the usual buttons; while recording, cancel, a live
                    waveform, stop and send; then a moment while it transcribes.
                    SwiftUI animates between them on the mode change. */}
                <HStack
                  spacing={8}
                  alignment="center"
                  modifiers={[
                    frame({ minHeight: COMPOSER_BUTTON }),
                    animation(Animation.snappy({ duration: 0.3 }), MODES.indexOf(voice.status)),
                  ]}
                >
                  {voice.status === "recording" ? (
                    <>
                      <Button
                        onPress={() => void voice.cancel()}
                        modifiers={[...plain, accessibilityLabel("Cancel recording")]}
                      >
                        <CircleLabel systemName="xmark" colors={colors} />
                      </Button>
                      <SwiftText
                        modifiers={[
                          font({ size: 13 }),
                          monospacedDigit(),
                          foregroundStyle(colors.fgTertiary),
                          lineLimit(1),
                          fixedSize({ horizontal: true }),
                          accessibilityLabel(`Recording, ${formatMillis(voice.durationMillis)}`),
                        ]}
                      >
                        {formatMillis(voice.durationMillis)}
                      </SwiftText>
                      {/* Takes up any rounding left over, so stop and send sit flush right. */}
                      <Spacer minLength={0} />
                      <VoiceWaveform
                        levels={voice.levels}
                        color={colors.fgSecondary}
                        bars={waveformBars}
                      />
                      <Button
                        onPress={() => void voice.stop()}
                        modifiers={[...plain, accessibilityLabel("Stop and edit the text")]}
                      >
                        <CircleLabel systemName="stop.fill" colors={colors} />
                      </Button>
                      <Button
                        onPress={() => void voice.stop({ send: true })}
                        modifiers={[...plain, accessibilityLabel("Stop and make cards")]}
                      >
                        <CircleLabel
                          systemName="arrow.up"
                          colors={colors}
                          color={colors.white}
                          fill={colors.actionBrandBg}
                        />
                      </Button>
                    </>
                  ) : voice.status === "transcribing" ? (
                    <>
                      <ProgressView
                        modifiers={[frame({ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON })]}
                      />
                      <SwiftText modifiers={[font({ size: 15 }), foregroundStyle(colors.fgSecondary)]}>
                        Transcribing…
                      </SwiftText>
                      <Spacer />
                    </>
                  ) : (
                    <>
                      <Menu
                        label={<CircleLabel systemName="plus" colors={colors} />}
                        // Top to bottom as written, even though the menu opens upward.
                        modifiers={[...plain, accessibilityLabel("Add a source"), menuOrder("fixed")]}
                      >
                        {renderEntries(addEntries)}
                      </Menu>
                      <Menu
                        // A short name in full; a long one shortened in code, since
                        // the pill keeps its full width.
                        label={
                          <PillLabel text={truncateTitle(deckLabel, DECK_LABEL_CHARS)} colors={colors} />
                        }
                        modifiers={[
                          ...plain,
                          accessibilityLabel(`Deck: ${deckLabel}`),
                          fixedSize({ horizontal: true }),
                          layoutPriority(1),
                        ]}
                      >
                        {renderEntries(deckEntries)}
                      </Menu>
                      <Spacer />
                      {cardOptions ? (
                        <CardOptionsMenu options={cardOptions.value} onChange={cardOptions.onChange} />
                      ) : (
                        <Button
                          onPress={onOptions}
                          modifiers={[...plain, accessibilityLabel("Card options")]}
                        >
                          <CircleLabel systemName="slider.horizontal.3" colors={colors} />
                        </Button>
                      )}
                      {sending ? (
                        <ProgressView
                          modifiers={[frame({ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON })]}
                        />
                      ) : hasContent ? (
                        // Something to send: Claude's solid send circle, muted if
                        // it can't go yet (offline, or this deck is busy).
                        <Button
                          onPress={onSend}
                          modifiers={[
                            ...plain,
                            accessibilityLabel("Make cards"),
                            disabledModifier(sendDisabled),
                          ]}
                        >
                          <CircleLabel
                            systemName="arrow.up"
                            colors={colors}
                            color={sendDisabled ? colors.fgTertiary : colors.white}
                            fill={sendDisabled ? colors.bgActive : colors.actionBrandBg}
                          />
                        </Button>
                      ) : (
                        // Nothing typed: the same place speaks the prompt instead.
                        <Button
                          onPress={() => void voice.start()}
                          modifiers={[...plain, accessibilityLabel("Speak your prompt")]}
                        >
                          <CircleLabel systemName="mic" colors={colors} />
                        </Button>
                      )}
                    </>
                  )}
                </HStack>
              </VStack>
            </GlassEffectContainer>
          </Host>
        </View>
      </GestureDetector>
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { gap: 8 },
    host: { alignSelf: "stretch" },
    attachment: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      maxWidth: "100%",
      minHeight: 36,
      paddingLeft: 12,
      paddingRight: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    attachmentName: { flexShrink: 1, fontSize: 14, lineHeight: 18, fontWeight: "500", color: colors.fgPrimary },
    attachmentRemove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    hint: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      justifyContent: "center",
      minHeight: 28,
      marginLeft: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    hintText: { fontSize: 13, lineHeight: 16, fontWeight: "500", color: colors.accentInk },
    hintAlert: { backgroundColor: colors.dangerSoft },
    hintAlertText: { color: colors.danger },
  });
}
