import type { BrowseCardRow } from "@deephaus/api-client";
import { cardTypeLabel, stripCardMedia } from "@deephaus/shared";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { RichCardContent } from "@/components/rich-card-content";
import { BadgePill } from "@/components/ui/badge-pill";
import { Card } from "@/components/ui/card";
import { UIText } from "@/components/ui/text";
import { deckDisplayName } from "@/lib/deck-name";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  card: BrowseCardRow;
  selected?: boolean;
  isNew?: boolean;
  /** Browse labels each row with its deck; a deck's own list shows the card type. */
  showDeck?: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

export function CardListItem({
  card,
  selected = false,
  isNew = false,
  showDeck = true,
  onPress,
  onLongPress,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const back = card.back && card.type === "basic" ? stripCardMedia(card.back) : "";

  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        haptics.selection();
        onLongPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint="Opens the card. Long press to select for bulk actions."
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      <Card
        padding={14}
        style={[selected && styles.selected, card.suspended && styles.suspended]}
      >
        <RichCardContent
          content={card.type === "basic" ? card.front ?? "" : card.cloze_text ?? ""}
          imageHeight={120}
        />
        {back ? (
          <UIText variant="muted" style={styles.cardBack} numberOfLines={2}>
            {back}
          </UIText>
        ) : null}
        <View style={styles.cardMeta}>
          {isNew && <BadgePill label="New" tone="brand" />}
          <UIText variant="label">
            {showDeck ? deckDisplayName(card.deck_name) : cardTypeLabel(card.type, "short")}
          </UIText>
          {card.tags.slice(0, 2).map((t) => (
            <BadgePill key={t} label={t} tone="gray" />
          ))}
          {card.suspended && <BadgePill label="Suspended" tone="gray" />}
        </View>
      </Card>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    selected: {
      borderColor: colors.brand500,
      backgroundColor: colors.brand25,
    },
    suspended: {
      opacity: 0.6,
    },
    cardBack: { marginTop: 6 },
    cardMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      alignItems: "center",
      marginTop: 10,
    },
  });
}
