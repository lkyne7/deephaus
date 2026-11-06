import { useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon } from "@/components/ui/icon";
import { NativeMenu } from "@/components/ui/native-menu";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

export type DeckSelectOption = { id: string; label: string };

type Props<T extends DeckSelectOption> = {
  /** Text on the trigger, usually the selected option's label. */
  value: string;
  /** Menu title on Android and the accessibility label. */
  title?: string;
  options: T[];
  selectedId?: string;
  onSelect: (option: T) => void;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function createTriggerStyles(colors: ThemeColors) {
  return StyleSheet.create({
    shell: {
      borderColor: colors.lineStrong,
      borderWidth: 1,
      borderRadius: radius.xl,
      overflow: "hidden",
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    small: {
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    label: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    labelSmall: {
      fontSize: 13,
      lineHeight: 18,
    },
  });
}

/** Field-shaped trigger for a native choice menu. */
export function DeckSelect<T extends DeckSelectOption>({
  value,
  title,
  options,
  selectedId,
  onSelect,
  small,
  disabled,
  style,
}: Props<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTriggerStyles(colors), [colors]);

  return (
    <NativeMenu
      label={title ?? value}
      fill
      disabled={disabled}
      style={style}
      entries={options.map((option) => ({
        label: option.label,
        selected: selectedId === undefined ? undefined : option.id === selectedId,
        onPress: () => onSelect(option),
      }))}
    >
      <View style={[styles.shell, { backgroundColor: colors.bgSurface }]}>
        <View style={[styles.button, small && styles.small]}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.label, small && styles.labelSmall]}
          >
            {value}
          </Text>
          <Icon name="arrowDown" size={14} color={colors.fgQuaternary} />
        </View>
      </View>
    </NativeMenu>
  );
}

export function DeckSelectLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "500",
        color: colors.fgQuaternary,
        marginBottom: 6,
        marginLeft: 4,
      }}
    >
      {children}
    </Text>
  );
}

