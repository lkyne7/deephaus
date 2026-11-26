import { cardTypeLabel, type CardType } from "@deephaus/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CardSaveStatus } from "@/components/card-editor/card-save-status";
import { Icon } from "@/components/ui/icon";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";
import { useTheme } from "@/lib/theme-context";

type Props = {
  type: CardType;
  /** Left out in study, whose header already names the deck. */
  deck?: string;
  status: AutoSaveStatus;
  error?: string | null;
  onRetry: () => void;
  /** Opens the card's details; without it the line is only a label. */
  onPress?: () => void;
};

/** What the card is and where it lives, above the card being edited. */
export function CardMetaLine({ type, deck, status, error, onRetry, onPress }: Props) {
  const { colors } = useTheme();
  const label = [cardTypeLabel(type, "short"), deck].filter(Boolean).join(" · ");
  const text = { fontSize: 14, lineHeight: 20, color: colors.fgSecondary, flexShrink: 1 };
  return (
    <View style={styles.wrap}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}. Card details`}
          onPress={onPress}
          style={({ pressed }) => [styles.line, pressed && styles.pressed]}
        >
          <Text style={text} numberOfLines={1}>
            {label}
          </Text>
          <Icon name="arrowDown" size={12} color={colors.fgTertiary} />
        </Pressable>
      ) : (
        <View style={styles.line}>
          <Text style={text} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
      {/* Holds its height so the card doesn't move as saving starts and ends. */}
      <View style={styles.status}>
        <CardSaveStatus status={status} error={error} onRetry={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  line: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  pressed: { opacity: 0.6 },
  status: { minHeight: 20, marginTop: -8 },
});
