import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View, type ViewStyle } from "react-native";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * The grouped form the card editor is built from (E2): a small grey heading,
 * then a white rounded group of fields or rows, like iOS Settings.
 */
export function FormSection({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View>
      {title ? (
        <Text style={styles.heading} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        <View style={styles.gap} />
      )}
      {children}
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

/** A white rounded group. `focused` rings it in the accent while a field in it is being typed in. */
export function FormGroup({
  focused,
  style,
  children,
}: {
  focused?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.group, focused && styles.focused, style]}>{children}</View>;
}

/** A field's padding inside a group. */
export function FormField({ children }: { children: ReactNode }) {
  return <View style={fieldStyle}>{children}</View>;
}
const fieldStyle: ViewStyle = { paddingHorizontal: 14, paddingVertical: 4 };

type RowProps = {
  label: string;
  /** Grey text on the right. */
  value?: string;
  /** A numbered badge before the label, as for blanks and labels. */
  number?: number;
  /** Red, for Delete. */
  destructive?: boolean;
  /** Grey label, for an "Add a…" row. */
  ghost?: boolean;
  first?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: ReactNode;
};

/** One row in a group: a label, an optional value or control on the right. */
export function FormRow({
  label,
  value,
  number,
  destructive,
  ghost,
  first,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  children,
}: RowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const content = (
    <>
      {number != null ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{number}</Text>
        </View>
      ) : null}
      <Text
        style={[styles.label, ghost && styles.ghost, destructive && styles.destructive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {value != null ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {children}
    </>
  );
  const rowStyle = [styles.row, !first && styles.divided];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

/** A row with a switch on the right. */
export function FormSwitchRow({
  label,
  value,
  onChange,
  first,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  first?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <FormRow label={label} first={first}>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.selection();
          onChange(next);
        }}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={label}
        style={{ marginLeft: "auto" }}
      />
    </FormRow>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    heading: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      paddingTop: 16,
      paddingBottom: 6,
      paddingHorizontal: 16,
    },
    gap: { height: 16 },
    footer: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      paddingTop: 6,
      paddingHorizontal: 16,
    },
    group: {
      backgroundColor: colors.bgSurface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      overflow: "hidden",
    },
    focused: {
      borderWidth: 1.5,
      borderColor: colors.accent,
      margin: -1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    pressed: { backgroundColor: colors.bgHover },
    badge: {
      width: 22,
      height: 22,
      borderRadius: 6,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { fontSize: 12, fontWeight: "600", color: colors.accentInk },
    label: { flexShrink: 1, fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    ghost: { color: colors.fgTertiary },
    destructive: { color: colors.danger },
    value: {
      marginLeft: "auto",
      flexShrink: 1,
      maxWidth: "60%",
      fontSize: 16,
      lineHeight: 21,
      color: colors.fgTertiary,
      textAlign: "right",
    },
  });
}
