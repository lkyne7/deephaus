import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ComposerHandle, ComposerProps } from "@/components/create/composer-types";
import { NativeComposer } from "@/components/create/native-composer";
import { pairCardStyle } from "@/components/home/pair-card";
import { liquidGlassAvailable } from "@/components/ui/glass-surface";
import { Icon } from "@/components/ui/icon";
import { NativeMenu } from "@/components/ui/native-menu";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type { ComposerHandle, ComposerProps };

/**
 * The one input for making cards: text, a link or a file, a deck, and send.
 * Native SwiftUI on Liquid Glass where iOS 26 is available, React Native
 * elsewhere. The choice is fixed for the life of the app.
 */
export const CreateComposer = forwardRef<ComposerHandle, ComposerProps>(function CreateComposer(
  props,
  ref,
) {
  return liquidGlassAvailable ? (
    <NativeComposer ref={ref} {...props} />
  ) : (
    <ReactNativeComposer ref={ref} {...props} />
  );
});

const ReactNativeComposer = forwardRef<ComposerHandle, ComposerProps>(function ReactNativeComposer(
  {
    value,
    onChangeText,
    placeholder,
    hint,
    attachmentName,
    onRemoveAttachment,
    onAdd,
    deckLabel,
    deckEntries,
    onOptions,
    onSend,
    canSend,
    sending,
    onFocus,
    onBlur,
  },
  ref,
) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const input = useRef<TextInput>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      blur: () => input.current?.blur(),
    }),
    [],
  );

  return (
    <View style={[pairCardStyle(colors), shadows.sm]}>
      {attachmentName ? (
        <View style={styles.attachment}>
          <Icon name="document" size={20} color={colors.fgSecondary} />
          <Text style={styles.attachmentName} numberOfLines={1}>
            {attachmentName}
          </Text>
          <Pressable
            onPress={onRemoveAttachment}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${attachmentName}`}
            style={({ pressed }) => [styles.attachmentRemove, pressed && styles.pressed]}
          >
            <Icon name="close" size={16} color={colors.fgTertiary} />
          </Pressable>
        </View>
      ) : null}
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fgTertiary}
        accessibilityLabel={placeholder}
        multiline
        textAlignVertical="top"
        onFocus={onFocus}
        onBlur={onBlur}
        style={styles.input}
      />
      {hint ? (
        <View style={styles.hint}>
          <Text style={styles.hintText} numberOfLines={1}>
            {hint}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add a source"
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <Icon name="add" size={20} color={colors.fgSecondary} />
        </Pressable>
        <NativeMenu label="Choose a deck" entries={deckEntries} style={styles.deckTrigger}>
          <View style={styles.deck}>
            <Icon name="folder" size={15} color={colors.fgTertiary} />
            <Text style={styles.deckLabel} numberOfLines={1}>
              {deckLabel}
            </Text>
            <Icon name="arrowDown" size={14} color={colors.fgTertiary} />
          </View>
        </NativeMenu>
        <Pressable
          onPress={onOptions}
          accessibilityRole="button"
          accessibilityLabel="Card options"
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <Icon name="equalizer" size={18} color={colors.fgSecondary} />
        </Pressable>
        <Pressable
          onPress={onSend}
          disabled={!canSend || sending}
          accessibilityRole="button"
          accessibilityLabel="Make cards"
          accessibilityState={{ disabled: !canSend || sending, busy: sending }}
          style={({ pressed }) => [
            styles.send,
            !canSend && styles.sendOff,
            pressed && styles.pressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.actionBrandFg} size="small" />
          ) : (
            <Icon
              name="arrowRight"
              size={18}
              color={colors.actionBrandFg}
              style={styles.sendIcon}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    attachment: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingLeft: 12,
      paddingRight: 4,
      borderRadius: radius.xl3,
      backgroundColor: colors.bgSunken,
    },
    attachmentName: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    attachmentRemove: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      minHeight: 46,
      maxHeight: 132,
      paddingHorizontal: 8,
      paddingTop: 2,
      paddingBottom: 2,
      fontSize: 16,
      lineHeight: 22,
      color: colors.fgPrimary,
    },
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
    row: { flexDirection: "row", alignItems: "center", gap: 6 },
    round: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    deckTrigger: { flexShrink: 1, minWidth: 0, marginRight: "auto" },
    deck: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    // The native menu sizes to its content, so a long deck name has to stop here.
    deckLabel: { flexShrink: 1, maxWidth: 104, fontSize: 14, lineHeight: 18, color: colors.fgSecondary },
    send: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.actionBrandBg,
    },
    sendOff: { opacity: 0.38 },
    sendIcon: { transform: [{ rotate: "-90deg" }] },
    pressed: { opacity: 0.6 },
  });
}
