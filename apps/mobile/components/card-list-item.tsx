import type { BrowseCardRow } from "@deephaus/api-client";
import { cardTypeLabel, stripCardMedia } from "@deephaus/shared";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { RichCardContent } from "@/components/rich-card-content";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
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

/** Front and back share one size so the answer reads as content, not a caption. */
const CONTENT_TEXT = { fontSize: 15, lineHeight: 21 } as const;
const CHIP = 22;

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
  const label = showDeck ? deckDisplayName(card.deck_name) : cardTypeLabel(card.type, "short");
  const tags = card.tags.slice(0, 2).map((t) => ` · #${t}`).join("");
  const dim = card.suspended && styles.dimmed;

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
      <Card padding={14} style={selected && styles.selected}>
        <View style={styles.typeChip}>
          <CardTypeGlyph type={card.type} colors={colors} />
        </View>
        <View style={[styles.front, dim]}>
          <RichCardContent
            content={card.type === "basic" ? card.front ?? "" : card.cloze_text ?? ""}
            imageHeight={120}
            textStyle={{ ...CONTENT_TEXT, color: colors.fgPrimary }}
          />
        </View>
        {back ? (
          <>
            <View style={styles.divider} />
            <UIText style={[styles.back, dim]} numberOfLines={2}>
              {back}
            </UIText>
          </>
        ) : null}
        <View style={styles.meta}>
          <UIText variant="label" style={styles.metaText} numberOfLines={1}>
            {isNew ? <UIText variant="label" style={styles.new}>New · </UIText> : null}
            <UIText variant="label" style={styles.deck}>{label}</UIText>
            {tags}
          </UIText>
          {card.suspended ? (
            <View style={styles.suspended}>
              <Icon name="pausePlayback" size={9} color={colors.fgQuaternary} />
              <UIText style={styles.suspendedText}>Suspended</UIText>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const TYPE_TONES = {
  basic: (c: ThemeColors) => ({ bg: c.brand50, fg: c.brand500 }),
  cloze: (c: ThemeColors) => ({ bg: c.orange50, fg: c.orange500 }),
  "image-occlusion": () => ({ bg: "rgba(124, 92, 252, 0.15)", fg: "#7c5cfc" }),
} as const;

/**
 * Drawn rather than taken from Ionicons: the closest stock glyphs for "front/back"
 * (two stacked cards) read as a copy button. This one is a card split into two halves,
 * echoing the divider in the row itself.
 */
function CardTypeGlyph({ type, colors }: { type: BrowseCardRow["type"]; colors: ThemeColors }) {
  const { bg, fg } = TYPE_TONES[type](colors);
  const stroke = { stroke: fg, strokeWidth: 1.5, strokeLinecap: "round", fill: "none" } as const;
  return (
    <View
      style={{ width: CHIP, height: CHIP, borderRadius: 7, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}
      accessibilityLabel={cardTypeLabel(type)}
    >
      <Svg width={13} height={13} viewBox="0 0 16 16">
        {type === "basic" ? (
          <>
            <Rect x={1.75} y={2.75} width={12.5} height={10.5} rx={2} {...stroke} />
            <Line x1={1.75} y1={8} x2={14.25} y2={8} {...stroke} />
          </>
        ) : type === "cloze" ? (
          <>
            <Path d="M4.5 3H3v10h1.5M11.5 3H13v10h-1.5" {...stroke} strokeLinejoin="round" />
            <Line x1={6} y1={8} x2={10} y2={8} {...stroke} strokeWidth={1.7} />
          </>
        ) : (
          <>
            <Rect x={1.75} y={2.75} width={12.5} height={10.5} rx={2} {...stroke} />
            <Rect x={4.5} y={5.5} width={7} height={3.5} rx={1} fill={fg} />
          </>
        )}
      </Svg>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    selected: {
      borderColor: colors.brand500,
      backgroundColor: colors.brand25,
    },
    typeChip: { position: "absolute", top: 12, right: 12 },
    // Keeps the first line of the question clear of the type chip.
    front: { paddingRight: CHIP + 8 },
    dimmed: { opacity: 0.5 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderSecondary,
      marginVertical: 10,
    },
    back: { ...CONTENT_TEXT, color: colors.fgSecondary },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    metaText: { flex: 1 },
    new: { color: colors.fgBrand, fontWeight: "600" },
    deck: { color: colors.fgSecondary, fontWeight: "600" },
    suspended: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: colors.gray100,
    },
    suspendedText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "600",
      color: colors.fgQuaternary,
    },
  });
}
