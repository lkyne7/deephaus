import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { theme } from "@/lib/theme";

type Props = TextInputProps & {
  containerStyle?: StyleProp<TextStyle>;
};

export function Input({ containerStyle, style, ...props }: Props) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.muted}
      style={[styles.input, style, containerStyle]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 12,
    color: theme.colors.text,
  },
});
