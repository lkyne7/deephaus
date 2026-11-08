import {
  Button,
  GlassEffectContainer,
  HStack,
  Host,
  Menu,
  ProgressView,
  Spacer,
  TextField,
  type TextFieldRef,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  frame,
  glassEffect,
  labelStyle,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComposerHandle, ComposerProps } from "@/components/create/composer-types";
import { Icon } from "@/components/ui/icon";
import { renderEntries } from "@/components/ui/native-menu.ios";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** SwiftUI's stand-in for double.infinity: wider than any screen. */
const FILL = 100_000;

/**
 * The composer as native SwiftUI on Liquid Glass, like the inputs in Claude's
 * and ChatGPT's apps: a SwiftUI text field that grows to six lines, with
 * system glass buttons in one glass panel, so the system draws, lights and
 * animates all of it.
 */
export const NativeComposer = forwardRef<ComposerHandle, ComposerProps>(function NativeComposer(
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
  const { colors, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const field = useRef<TextFieldRef>(null);
  // The text the field last reported, so changes made by Home (clearing after
  // send, restoring a draft) are pushed in and the user's typing isn't echoed.
  // Starts empty so a draft that's already set (a retry) is pushed in on mount.
  const fieldText = useRef("");

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
  const iconButton = [buttonStyle("glass"), buttonBorderShape("circle"), controlSize("large"), labelStyle("iconOnly")];

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
      {hint ? (
        <View style={styles.hint}>
          <Text style={styles.hintText} numberOfLines={1}>
            {hint}
          </Text>
        </View>
      ) : null}

      <Host matchContents={{ vertical: true }} colorScheme={colorScheme} style={styles.host}>
        <GlassEffectContainer spacing={8}>
          <VStack
            alignment="leading"
            spacing={10}
            modifiers={[
              frame({ maxWidth: FILL, alignment: "leading" }),
              padding({ top: 14, leading: 10, trailing: 10, bottom: 10 }),
              glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: 26 }),
            ]}
          >
            <TextField
              ref={field}
              axis="vertical"
              placeholder={placeholder}
              onTextChange={(text) => {
                fieldText.current = text;
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
            <HStack spacing={8} alignment="center">
              <Button label="Add a source" systemImage="plus" onPress={onAdd} modifiers={iconButton} />
              <Menu
                label={deckLabel}
                systemImage="folder"
                modifiers={[buttonStyle("glass"), controlSize("large")]}
              >
                {renderEntries(deckEntries)}
              </Menu>
              <Button
                label="Card options"
                systemImage="slider.horizontal.3"
                onPress={onOptions}
                modifiers={iconButton}
              />
              <Spacer />
              {sending ? (
                <ProgressView modifiers={[padding({ all: 12 })]} />
              ) : (
                <Button
                  label="Make cards"
                  systemImage="arrow.up"
                  onPress={onSend}
                  modifiers={[
                    buttonStyle("glassProminent"),
                    buttonBorderShape("circle"),
                    controlSize("large"),
                    labelStyle("iconOnly"),
                    tint(colors.actionBrandBg),
                    disabledModifier(sendDisabled),
                  ]}
                />
              )}
            </HStack>
          </VStack>
        </GlassEffectContainer>
      </Host>
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
  });
}
