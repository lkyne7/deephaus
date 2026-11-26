import type { BrowseCardRow } from "@deephaus/api-client";
import { Fragment, useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { clozeAnswers } from "@/components/cloze-text";
import { RichCardContent } from "@/components/rich-card-content";
import { Icon } from "@/components/ui/icon";
import { plainCardText } from "@/lib/card-preview";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** What a row needs from a card: the user's own (browse) or a community deck's. */
export type CardFaces = Pick<BrowseCardRow, "type" | "front" | "back" | "cloze_text" | "extra"> & {
  suspended?: boolean;
};

type Props = {
  card: CardFaces;
  selected?: boolean;
  /** A selection is active, so a tap toggles this row instead of opening it. */
  selecting?: boolean;
  isNew?: boolean;
  /** A quiet line under the card, e.g. its deck in the all-cards list. */
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

/** Question and answer share one size, so the answer reads as content, not a caption. */
const TEXT = { fontSize: 15, lineHeight: 21 } as const;
const MAX_LINES = 4;

/**
 * One card in any list (a deck, all cards, cards just made, a community deck): the
 * question on the left, the answer on the right, split by a hairline. A cloze shows
 * its blanks on the left and the missing words on the right, numbered when there are
 * several. Only the study reviewer draws cards differently.
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
  const question = cloze ? card.cloze_text : card.front;
  const dim = card.suspended && styles.dimmed;
  const note = [caption, card.suspended ? "Suspended" : null].filter(Boolean).join(" · ");

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
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <View style={[styles.split, dim]}>
        {isNew ? <View style={styles.newDot} accessibilityLabel="New" /> : null}
        <View style={styles.question}>
          <View style={styles.clip}>
            <RichCardContent
              content={question ?? ""}
              clozeMode={cloze ? "list" : "plain"}
              imageHeight={72}
              numberOfLines={MAX_LINES}
              textStyle={{
                ...TEXT,
                fontWeight: "500",
                color: colors.fgPrimary,
              }}
            />
          </View>
        </View>
        <View style={styles.rule} />
        <View style={styles.answer}>
          <View style={styles.clip}>
            {cloze ? (
              <ClozeAnswer text={card.cloze_text} extra={card.extra} styles={styles} />
            ) : (
              <RichCardContent
                content={card.back ?? ""}
                imageHeight={72}
                numberOfLines={MAX_LINES}
                textStyle={{ ...TEXT, color: colors.fgSecondary }}
              />
            )}
          </View>
        </View>
        {selecting ? (
          <View style={[styles.check, selected ? styles.checkOn : styles.checkOff]}>
            {selected ? <Icon name="check" size={12} color={colors.actionPrimaryFg} /> : null}
          </View>
        ) : null}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Pressable>
  );
}

/** The missing words, numbered when the card has several blanks, then the Extra. */
function ClozeAnswer({
  text,
  extra,
  styles,
}: {
  text: string | null;
  extra: string | null;
  styles: ReturnType<typeof createStyles>;
}) {
  const answers = clozeAnswers(text);
  const numbered = answers.length > 1;
  const extraText = plainCardText(extra).trim();
  return (
    <Text style={styles.answerText} numberOfLines={MAX_LINES}>
      {answers.map(({ ord, answer }, index) => (
        <Fragment key={ord}>
          {index > 0 ? (numbered ? "\n" : ", ") : null}
          {numbered ? <Text style={styles.number}>{`${ord} `}</Text> : null}
          {answer}
        </Fragment>
      ))}
      {extraText ? <Text style={styles.extra}>{` · ${extraText}`}</Text> : null}
    </Text>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.bgSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: radius.xl2,
    },
    pressed: { backgroundColor: colors.bgHover },
    selected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    split: { flexDirection: "row", alignItems: "stretch" },
    dimmed: { opacity: 0.45 },
    newDot: {
      position: "absolute",
      left: 5,
      top: 16,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.accent,
    },
    question: {
      flex: 1.65,
      paddingVertical: 9,
      paddingLeft: 14,
      paddingRight: 11,
    },
    rule: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
      marginVertical: 9,
    },
    answer: { flex: 1, paddingVertical: 9, paddingLeft: 11, paddingRight: 14 },
    // Clips at whole lines; images and display formulas may show only their top.
    clip: { maxHeight: TEXT.lineHeight * MAX_LINES, overflow: "hidden" },
    answerText: { ...TEXT, color: colors.fgSecondary },
    number: { fontSize: 12, fontWeight: "700", color: colors.accentInk },
    extra: { color: colors.fgTertiary },
    note: {
      paddingHorizontal: 14,
      paddingBottom: 8,
      marginTop: -2,
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    check: {
      position: "absolute",
      right: 8,
      top: 8,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: colors.actionPrimaryBg },
    checkOff: {
      borderWidth: 1.5,
      borderColor: colors.fgQuaternary,
      backgroundColor: colors.bgSurface,
    },
  });
}
