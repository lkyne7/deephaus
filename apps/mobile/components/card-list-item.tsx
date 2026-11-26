import type { BrowseCardRow } from "@deephaus/api-client";
import type { ImageOcclusionData } from "@deephaus/shared";
import { Image } from "expo-image";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { clozeAnswers } from "@/components/cloze-text";
import { RichCardContent } from "@/components/rich-card-content";
import { Icon } from "@/components/ui/icon";
import { plainCardText } from "@/lib/card-preview";
import { haptics } from "@/lib/haptics";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** What a row needs from a card: the user's own (browse) or a community deck's. */
export type CardFaces = Pick<BrowseCardRow, "type" | "front" | "back" | "cloze_text" | "extra"> & {
  suspended?: boolean;
  tags?: string[] | null;
  occlusion_data?: unknown;
};

type Props = {
  card: CardFaces;
  selected?: boolean;
  /** A selection is active, so a tap toggles this row instead of opening it. */
  selecting?: boolean;
  isNew?: boolean;
  /** Extra context for the meta line, e.g. the card's deck in the all-cards list. */
  caption?: string;
  /** Optional because NativeLinkMenu supplies it. */
  onPress?: PressableProps["onPress"];
  /** Android's row menu. iOS long-press belongs to the system context menu. */
  onLongPress?: () => void;
  accessibilityHint?: string;
  /** Set by NativeLinkMenu when VoiceOver is running. */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
};

const TEXT = { fontSize: 16, lineHeight: 22 } as const;
const QUESTION_LINES = 3;
const ANSWER_LINES = 2;
/** Rows are flat; the pressed and selected tint reaches this far past the text. */
const BLEED = 12;

const TYPE_LABEL: Record<CardFaces["type"], string> = {
  basic: "Front and back",
  cloze: "Fill-in-the-blank",
  "image-occlusion": "Image occlusion",
};

function occlusionOf(card: CardFaces): ImageOcclusionData | null {
  const data = card.occlusion_data as ImageOcclusionData | null | undefined;
  return data && typeof data.imageUrl === "string" && Array.isArray(data.rects) ? data : null;
}

/** "Dendrites, cell body, nucleus, axon and 2 more" from a card's labels. */
function labelSummary(data: ImageOcclusionData): string {
  const names = data.rects
    .filter((rect) => rect.enabled !== false)
    .map((rect) => rect.label?.trim())
    .filter((label): label is string => Boolean(label));
  if (names.length === 0) return "";
  const shown = names.slice(0, 4).map((name, index) => (index === 0 ? name : name.toLowerCase()));
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** The meta line: New, type, blanks or labels, the first tag, the caption, Suspended. */
function metaParts(card: CardFaces, caption?: string): string[] {
  const parts: string[] = [TYPE_LABEL[card.type] ?? card.type];
  if (card.type === "cloze") {
    const blanks = clozeAnswers(card.cloze_text).length;
    if (blanks > 1) parts.push(`${blanks} blanks`);
  } else if (card.type === "image-occlusion") {
    const data = occlusionOf(card);
    const count = data ? new Set(data.rects.filter((r) => r.enabled !== false).map((r) => r.ord ?? 1)).size : 0;
    if (count > 0) parts.push(`${count} label${count === 1 ? "" : "s"}`);
  }
  const tag = card.tags?.find((t) => t.trim());
  if (tag) parts.push(`#${tag}`);
  if (caption) parts.push(caption);
  if (card.suspended) parts.push("Suspended");
  return parts;
}

/**
 * One card in any list (a deck, all cards, cards just made, a community deck): a flat
 * row with the question, the answer under it in grey, and a small meta line. A cloze
 * shows its sentence with the answers filled in; an image occlusion card shows its
 * title, its labels and a thumbnail. Only the study reviewer draws cards differently.
 */
export function CardListItem({
  card,
  selected = false,
  selecting = false,
  isNew = false,
  caption,
  onPress,
  onLongPress,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cloze = card.type === "cloze";
  const occlusion = card.type === "image-occlusion" ? occlusionOf(card) : null;
  const question = cloze ? card.cloze_text : card.front;
  const answer = cloze
    ? plainCardText(card.extra).trim()
    : occlusion
      ? labelSummary(occlusion)
      : (card.back ?? "");
  const meta = metaParts(card, caption);

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
      accessibilityRole={onPress || onLongPress ? "button" : undefined}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityState={{ selected }}
      accessibilityHint={
        onPress || onLongPress
          ? (accessibilityHint ??
            (selecting ? "Selects or deselects the card." : "Opens the card."))
          : undefined
      }
      style={styles.row}
    >
      {({ pressed }) => (
        <>
      <View
        pointerEvents="none"
        style={[styles.tint, selected && styles.selected, pressed && !selected && styles.pressed]}
      />
      <View style={[styles.inner, card.suspended && styles.dimmed]}>
        <View style={styles.text}>
          <RichCardContent
            content={question ?? ""}
            clozeMode={cloze ? "revealed" : "plain"}
            imageHeight={56}
            numberOfLines={QUESTION_LINES}
            textStyle={{ ...TEXT, fontWeight: "500", color: colors.fgPrimary }}
          />
          {answer ? (
            occlusion || cloze ? (
              <Text style={styles.answer} numberOfLines={ANSWER_LINES}>
                {answer}
              </Text>
            ) : (
              <View style={styles.answerRich}>
                <RichCardContent
                  content={answer}
                  imageHeight={56}
                  numberOfLines={ANSWER_LINES}
                  textStyle={{ ...TEXT, color: colors.fgSecondary }}
                />
              </View>
            )
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {isNew ? <Text style={styles.new}>New · </Text> : null}
            {meta.join(" · ")}
          </Text>
        </View>
        {occlusion ? (
          <Image
            source={{ uri: occlusion.imageUrl }}
            style={styles.thumb}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {selecting ? (
          <View style={[styles.check, selected ? styles.checkOn : styles.checkOff]}>
            {selected ? <Icon name="check" size={12} color={colors.actionPrimaryFg} /> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.rule} />
        </>
      )}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {},
    // Drawn past the row's edges so the text keeps its alignment with the page.
    tint: {
      position: "absolute",
      top: 1,
      bottom: 1,
      left: -BLEED,
      right: -BLEED,
      borderRadius: 12,
    },
    pressed: { backgroundColor: colors.bgHover },
    selected: { backgroundColor: colors.accentSoft },
    inner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 12,
    },
    dimmed: { opacity: 0.45 },
    text: { flex: 1, minWidth: 0 },
    answer: { ...TEXT, color: colors.fgSecondary, marginTop: 2 },
    answerRich: { marginTop: 2, maxHeight: TEXT.lineHeight * ANSWER_LINES, overflow: "hidden" },
    meta: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary, marginTop: 4 },
    new: { color: colors.accentInk, fontWeight: "500" },
    thumb: {
      width: 80,
      height: 50,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkOn: { backgroundColor: colors.actionPrimaryBg },
    checkOff: {
      borderWidth: 1.5,
      borderColor: colors.fgQuaternary,
      backgroundColor: colors.bgSurface,
    },
  });
}
