import { useEffect, useMemo, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEditorToolbar } from "@/components/card-editor/editor-toolbar-context";
import { Icon, type IconName } from "@/components/ui/icon";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { CLOZE_IDS } from "@/lib/card-text-editing";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type ToolButtonProps = {
  label: string;
  glyph?: string;
  glyphStyle?: object;
  icon?: IconName;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

function ToolButton({ label, glyph, glyphStyle, icon, active, disabled, onPress }: ToolButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tint = disabled ? colors.fgDisabled : active ? colors.accentInk : colors.fgSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={20} color={tint} />
      ) : (
        <Text style={[styles.glyph, { color: tint }, glyphStyle]}>{glyph}</Text>
      )}
    </Pressable>
  );
}

/**
 * Whether the software keyboard is up. A web view can hold editor focus
 * without a keyboard (after a native modal, for example), and the bar must
 * not sit at the bottom of the screen in that state.
 */
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** A text action pinned at the bar's right end, such as Preview or Next card. */
export type EditorToolbarTrailingAction = {
  label: string;
  accessibilityHint?: string;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * Formatting bar pinned above the keyboard while a card field is focused.
 * Also hosts the LaTeX and cloze-hint prompts, which outlive field focus.
 */
export function EditorKeyboardToolbar({
  trailingActions = [],
}: {
  trailingActions?: EditorToolbarTrailingAction[];
} = {}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { active: focusedField, prompt, openPrompt, closePrompt, getField } = useEditorToolbar();
  const keyboardVisible = useKeyboardVisible();
  const active = keyboardVisible && !prompt ? focusedField : null;

  const state = active?.state;
  const handle = active?.handle.current ?? null;
  const disabled = !active || active.disabled;
  const cloze = state?.cloze ?? null;

  function promptField() {
    return prompt ? (getField(prompt.fieldId)?.handle.current ?? null) : null;
  }

  return (
    <>
      {active ? (
        <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel={`${active.label} formatting`}>
          {active.clozeEnabled && cloze ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              <Text style={styles.rowLabel}>Blank</Text>
              {CLOZE_IDS.map((id) => {
                const selected = cloze.id === id;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={`Blank ${id.slice(1)}`}
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      haptics.selection();
                      handle?.setClozeId(id);
                    }}
                    style={[styles.chip, selected && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {id.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cloze.hint ? `Edit hint: ${cloze.hint}` : "Add hint"}
                disabled={disabled}
                onPress={() =>
                  openPrompt({ kind: "hint", fieldId: active.id, hint: cloze.hint ?? "" })
                }
                style={[styles.chip, styles.chipWide, cloze.hint ? styles.chipActive : null]}
              >
                <Text
                  style={[styles.chipText, cloze.hint ? styles.chipTextActive : null]}
                  numberOfLines={1}
                >
                  {cloze.hint ? `Hint: ${cloze.hint}` : "Add hint"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove blank"
                disabled={disabled}
                onPress={() => {
                  haptics.selection();
                  handle?.removeCloze();
                }}
                style={[styles.chip, styles.chipWide]}
              >
                <Text style={[styles.chipText, { color: colors.danger }]}>Remove</Text>
              </Pressable>
            </ScrollView>
          ) : null}
          <View style={styles.mainRow}>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
              style={{ flex: 1 }}
            >
              {active.clozeEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Make blank"
                  accessibilityHint="Blanks the selected words, or the word at the cursor."
                  accessibilityState={{ disabled: disabled || Boolean(cloze) }}
                  disabled={disabled || Boolean(cloze)}
                  onPress={() => {
                    haptics.selection();
                    handle?.addCloze();
                  }}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.blank,
                    pressed && styles.blankPressed,
                    cloze && styles.blankUsed,
                  ]}
                >
                  <Text style={styles.blankText}>Make blank</Text>
                </Pressable>
              ) : null}
              <ToolButton
                label="Bold"
                glyph="B"
                glyphStyle={styles.bold}
                active={state?.bold}
                disabled={disabled}
                onPress={() => handle?.toggleBold()}
              />
              <ToolButton
                label="Italic"
                glyph="I"
                glyphStyle={styles.italic}
                active={state?.italic}
                disabled={disabled}
                onPress={() => handle?.toggleItalic()}
              />
              <ToolButton
                label="Underline"
                glyph="U"
                glyphStyle={styles.underline}
                active={state?.underline}
                disabled={disabled}
                onPress={() => handle?.toggleUnderline()}
              />
              <ToolButton
                label="Strikethrough"
                glyph="S"
                glyphStyle={styles.strike}
                active={state?.strike}
                disabled={disabled}
                onPress={() => handle?.toggleStrike()}
              />
              <ToolButton
                label="Inline code"
                icon="textSnippet"
                active={state?.code}
                disabled={disabled}
                onPress={() => handle?.toggleCode()}
              />
              <View style={styles.separator} />
              <ToolButton
                label="Bullet list"
                icon="list"
                active={state?.bulletList}
                disabled={disabled}
                onPress={() => handle?.toggleBulletList()}
              />
              <ToolButton
                label="Numbered list"
                glyph="1."
                glyphStyle={styles.bold}
                active={state?.orderedList}
                disabled={disabled}
                onPress={() => handle?.toggleOrderedList()}
              />
              <View style={styles.separator} />
              <ToolButton
                label="Insert formula"
                glyph="∑"
                glyphStyle={styles.bold}
                disabled={disabled}
                onPress={() =>
                  openPrompt({ kind: "latex", fieldId: active.id, formula: "", display: false, pos: null })
                }
              />
              <ToolButton
                label={`Add image to ${active.label.toLowerCase()}`}
                icon="image"
                disabled={disabled}
                onPress={active.addImage}
              />
              <ToolButton
                label={`Add audio to ${active.label.toLowerCase()}`}
                icon="mic"
                disabled={disabled}
                onPress={active.addAudio}
              />
              <View style={styles.separator} />
              <ToolButton
                label="Undo"
                icon="undo"
                disabled={disabled || !state?.canUndo}
                onPress={() => handle?.undo()}
              />
              <ToolButton
                label="Redo"
                icon="redo"
                disabled={disabled || !state?.canRedo}
                onPress={() => handle?.redo()}
              />
            </ScrollView>
            {trailingActions.map((trailingAction) => (
              <Pressable
                key={trailingAction.label}
                accessibilityRole="button"
                accessibilityLabel={trailingAction.label}
                accessibilityHint={trailingAction.accessibilityHint}
                accessibilityState={{ disabled: Boolean(trailingAction.disabled) }}
                disabled={trailingAction.disabled}
                onPress={trailingAction.onPress}
                hitSlop={4}
                style={({ pressed }) => [styles.trailing, pressed && styles.buttonPressed]}
              >
                <Text
                  style={[
                    styles.trailingText,
                    trailingAction.disabled && { color: colors.fgDisabled },
                  ]}
                >
                  {trailingAction.label}
                </Text>
              </Pressable>
            ))}
            <View style={styles.doneWrap}>
              <ToolButton
                label="Hide keyboard"
                icon="arrowDown"
                onPress={() => {
                  handle?.blur();
                  Keyboard.dismiss();
                }}
              />
            </View>
          </View>
        </View>
      ) : null}

      <TextPromptModal
        visible={prompt?.kind === "latex"}
        title={prompt?.kind === "latex" && prompt.pos != null ? "Edit formula" : "Insert formula"}
        description={"LaTeX, for example \\frac{a}{b} or x^2."}
        placeholder={"\\frac{a}{b}"}
        initialValue={prompt?.kind === "latex" ? prompt.formula : ""}
        submitLabel={prompt?.kind === "latex" && prompt.pos != null ? "Update" : "Insert"}
        accessibilityLabel="Formula"
        autoCapitalize="none"
        onSubmit={(formula) => {
          if (prompt?.kind !== "latex") return;
          const trimmed = formula.trim();
          if (!trimmed) return;
          const target = promptField();
          if (prompt.pos != null) target?.setLatexFormula(prompt.pos, trimmed);
          else target?.insertLatex(trimmed, prompt.display);
          // The modal took the keyboard; the editor can't bring it back itself.
          target?.blur();
        }}
        onClose={closePrompt}
      />
      <TextPromptModal
        visible={prompt?.kind === "hint"}
        title="Hint"
        description="Shown in the blank while studying."
        placeholder="Optional hint"
        initialValue={prompt?.kind === "hint" ? prompt.hint : ""}
        clearLabel={prompt?.kind === "hint" && prompt.hint ? "Remove hint" : undefined}
        accessibilityLabel="Hint for this blank"
        onSubmit={(hint) => {
          const target = promptField();
          target?.setClozeHint(hint.trim() || null);
          target?.blur();
        }}
        onClear={() => {
          const target = promptField();
          target?.setClozeHint(null);
          target?.blur();
        }}
        onClose={closePrompt}
      />
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    mainRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 0,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    rowLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
      marginRight: 4,
    },
    button: {
      minWidth: 38,
      minHeight: 44,
      paddingHorizontal: 4,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonActive: {
      backgroundColor: colors.accentSoft,
    },
    buttonPressed: {
      backgroundColor: colors.bgHover,
    },
    glyph: {
      fontSize: 17,
      fontWeight: "500",
    },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    underline: { textDecorationLine: "underline" },
    strike: { textDecorationLine: "line-through" },
    blank: {
      height: 36,
      paddingHorizontal: 14,
      marginHorizontal: 4,
      borderRadius: radius.pill,
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    blankPressed: { backgroundColor: colors.brand200 },
    blankUsed: { opacity: 0.45 },
    blankText: { fontSize: 15, fontWeight: "600", color: colors.accentInk },
    separator: {
      width: StyleSheet.hairlineWidth,
      height: 24,
      backgroundColor: colors.line,
      marginHorizontal: 2,
    },
    trailing: {
      minHeight: 44,
      paddingHorizontal: 10,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.line,
      justifyContent: "center",
    },
    trailingText: { fontSize: 15, fontWeight: "600", color: colors.accentInk },
    doneWrap: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.line,
      paddingHorizontal: 4,
    },
    chip: {
      minHeight: 36,
      minWidth: 40,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: "center",
      justifyContent: "center",
    },
    chipWide: {
      maxWidth: 180,
    },
    chipActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    chipText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    chipTextActive: {
      color: colors.accentInk,
    },
  });
}
