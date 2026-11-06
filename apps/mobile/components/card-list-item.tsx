import type { BrowseCardRow } from "@deephaus/api-client";
import { cardTypeLabel } from "@deephaus/shared";
import { useMemo } from "react";
import { Pressable, StyleSheet, View, type PressableProps } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import { RichCardContent } from "@/components/rich-card-content";
import { Icon } from "@/components/ui/icon";
import { UIText } from "@/components/ui/text";
import { plainCardText } from "@/lib/card-preview";
import { deckDisplayName } from "@/lib/deck-name";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  card: BrowseCardRow;
  selected?: boolean;
  /** A selection is active, so a tap toggles this row instead of opening it. */
  selecting?: boolean;
  isNew?: boolean;
  /** Browse labels each row with its deck; a deck's own list shows the card type. */
  showDeck?: boolean;
  /** Optional because NativeLinkMenu supplies it. */
  onPress?: PressableProps["onPress"];
  /** Android's row menu. iOS long-press belongs to the system context menu. */
  onLongPress?: () => void;
  /** Set by NativeLinkMenu when VoiceOver is running. */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
};

/** Front and back share one size so the answer reads as content, not a caption. */
const CONTENT_TEXT = { fontSize: 16, lineHeight: 22 } as const;
const SLOT = 20;
/** Keeps the text clear of a selected row's tint. */
const ROW_INSET = 12;

export function CardListItem({
  card,
  selected = false,
  selecting = false,
  isNew = false,
  showDeck = true,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const back = card.back && card.type === "basic" ? plainCardText(card.back) : "";
  const label = showDeck ? deckDisplayName(card.deck_name) : cardTypeLabel(card.type, "short");
  const tags = card.tags.slice(0, 2).map((t) => ` · #${t}`).join("");
  const dim = card.suspended && styles.dimmed;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              haptics.selection();
              onLongPress();
            }
          : undefined
      }
      accessibilityRole="button"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityState={{ selected }}
      accessibilityHint={selecting ? "Selects or deselects the card." : "Opens the card."}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        selected && styles.selected,
      ]}
    >
      <View style={styles.slot} accessibilityLabel={cardTypeLabel(card.type)}>
        {selected ? (
          <View style={styles.check}>
            <Icon name="check" size={13} color={colors.actionPrimaryFg} />
          </View>
        ) : selecting ? (
          <View style={styles.unchecked} />
        ) : (
          <CardTypeGlyph type={card.type} color={colors.fgTertiary} />
        )}
      </View>
      <View style={[styles.front, dim]}>
        <RichCardContent
          content={card.type === "basic" ? card.front ?? "" : card.cloze_text ?? ""}
          imageHeight={120}
          textStyle={{ ...CONTENT_TEXT, fontWeight: "500", color: colors.fgPrimary }}
        />
      </View>
      {back ? (
        <UIText style={[styles.back, dim]} numberOfLines={2}>
          {back}
        </UIText>
      ) : null}
      <View style={styles.meta}>
        <UIText variant="muted" style={styles.metaText} numberOfLines={1}>
          {isNew ? <UIText variant="muted" style={styles.new}>New · </UIText> : null}
          {label}
          {tags}
        </UIText>
        {card.suspended ? (
          <View style={styles.suspended}>
            <Icon name="pausePlayback" size={9} color={colors.fgTertiary} />
            <UIText style={styles.suspendedText}>Suspended</UIText>
          </View>
        ) : null}
      </View>
      {selected ? null : <View style={styles.divider} />}
    </Pressable>
  );
}

/**
 * Drawn rather than taken from Ionicons: the closest stock glyphs for "front/back"
 * (two stacked cards) read as a copy button. This one is a card split into two halves.
 */
function CardTypeGlyph({ type, color }: { type: BrowseCardRow["type"]; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.5, strokeLinecap: "round", fill: "none" } as const;
  return (
    <Svg width={14} height={14} viewBox="0 0 16 16">
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
          <Rect x={4.5} y={5.5} width={7} height={3.5} rx={1} fill={color} />
        </>
      )}
    </Svg>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      marginHorizontal: 8,
      paddingHorizontal: ROW_INSET,
      paddingVertical: 12,
      borderRadius: radius.xl2,
    },
    pressed: { backgroundColor: colors.bgHover },
    selected: { backgroundColor: colors.bgActive },
    slot: {
      position: "absolute",
      top: 12,
      right: ROW_INSET,
      width: SLOT,
      height: SLOT,
      alignItems: "center",
      justifyContent: "center",
    },
    check: {
      width: 18,
      height: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.actionPrimaryBg,
      alignItems: "center",
      justifyContent: "center",
    },
    unchecked: {
      width: 18,
      height: 18,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.fgQuaternary,
    },
    // Keeps the first line of the question clear of the type glyph.
    front: { paddingRight: SLOT + 8 },
    dimmed: { opacity: 0.5 },
    divider: {
      position: "absolute",
      left: ROW_INSET,
      right: ROW_INSET,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
    },
    back: { ...CONTENT_TEXT, color: colors.fgSecondary, marginTop: 2 },
    meta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
    metaText: { flex: 1 },
    new: { color: colors.accentInk },
    suspended: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    suspendedText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
  });
}
