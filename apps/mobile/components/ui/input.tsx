import { forwardRef, useMemo, useState, type ReactNode } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

type FieldProps = TextInputProps & {
  leadingIcon?: IconName;
  trailing?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  error?: boolean;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.bgSurface,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      borderRadius: radius.lg,
    },
    fieldFocused: {
      borderColor: colors.brand300,
    },
    fieldError: {
      borderColor: colors.gradeAgain,
    },
    input: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      color: colors.fgPrimary,
      padding: 0,
      margin: 0,
    },
  });
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { leadingIcon, trailing, containerStyle, inputStyle, error, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.field,
        focused && styles.fieldFocused,
        error && styles.fieldError,
        containerStyle,
      ]}
    >
      {leadingIcon && <Icon name={leadingIcon} size={18} color={colors.fgQuaternary} />}
      <TextInput
        ref={ref}
        {...rest}
        placeholderTextColor={colors.fgPlaceholder}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, inputStyle]}
      />
      {trailing}
    </View>
  );
});

export const Input = forwardRef<TextInput, FieldProps>(function Input(props, ref) {
  return <Field ref={ref} {...props} />;
});
