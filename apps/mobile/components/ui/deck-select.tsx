import { useMemo } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface, liquidGlassAvailable } from "@/components/ui/glass-surface";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { layout, radius, type ThemeColors } from "@/lib/theme";

type Props = {
  value: string;
  onPress?: () => void;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function createTriggerStyles(colors: ThemeColors) {
  return StyleSheet.create({
    shell: {
      borderColor: colors.borderPrimary,
      borderWidth: liquidGlassAvailable ? 0 : 1,
      borderRadius: radius.pill,
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
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.85,
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

export function DeckSelect({ value, onPress, small, disabled, style }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTriggerStyles(colors), [colors]);

  return (
    <GlassSurface
      fallbackColor={colors.bgSurface}
      glassEffectStyle="clear"
      interactive
      style={[styles.shell, style]}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          small && styles.small,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.label, small && styles.labelSmall]}
        >
          {value}
        </Text>
        <Icon name="arrowDown" size={18} color={colors.fgQuaternary} />
      </Pressable>
    </GlassSurface>
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

type DeckSelectModalProps<T extends { id: string; label: string }> = {
  visible: boolean;
  options: T[];
  selectedId?: string;
  title?: string;
  onSelect: (option: T) => void;
  onClose: () => void;
};

function createModalStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    sheet: {
      marginHorizontal: layout.floatingGlassInset,
      borderRadius: layout.floatingGlassRadius,
      paddingTop: 12,
      paddingBottom: 16,
      maxHeight: "70%",
      overflow: "hidden",
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    rowLabel: {
      fontSize: 15,
      color: colors.fgSecondary,
      flex: 1,
    },
    rowLabelActive: {
      color: colors.brand700,
      fontWeight: "600",
    },
    divider: {
      height: 1,
      backgroundColor: colors.borderTertiary,
    },
  });
}

export function DeckSelectModal<T extends { id: string; label: string }>({
  visible,
  options,
  selectedId,
  title,
  onSelect,
  onClose,
}: DeckSelectModalProps<T>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const modalStyles = useMemo(() => createModalStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={modalStyles.scrim} onPress={onClose}>
        <GlassSurface
          fallbackColor={colors.bgSurface}
          glassEffectStyle="regular"
          style={[
            modalStyles.sheet,
            { marginBottom: Math.max(insets.bottom, layout.floatingGlassInset) },
          ]}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {title && <Text style={modalStyles.title}>{title}</Text>}
          <FlatList
            data={options}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={modalStyles.divider} />}
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              return (
                <TouchableOpacity
                  style={modalStyles.row}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <Text style={[modalStyles.rowLabel, active && modalStyles.rowLabelActive]}>
                    {item.label}
                  </Text>
                  {active && <Icon name="check" size={18} color={colors.brand600} />}
                </TouchableOpacity>
              );
            }}
          />
        </GlassSurface>
      </Pressable>
    </Modal>
  );
}
