import { useMemo, type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { InlineMath, inlineMathDepth } from "@/components/math-formula";
import { emphasisFont } from "@/lib/fonts";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

// `$…$` and `$$…$$` mirror @deephaus/rich-text's markdown parser. RichCardContent lifts
// `$$…$$` onto its own line first; anywhere else (list rows) it renders inline.
const TOKEN_PATTERN =
  /\{\{c(\d+)::([^:}]*)(?:::([^}]*))?\}\}|\*\*([^*]+)\*\*|(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)|\$\$([\s\S]+?)\$\$/g;

type Mode = "hidden" | "revealed" | "plain" | "list";

type Props = {
  text: string;
  /**
   * hidden: the asked blank (or every blank) is empty; revealed / plain: answers in the
   * cloze tint; list: every blank empty, numbered when the card has more than one.
   */
  mode?: Mode;
  activeClozeOrd?: number | null;
  studyView?: boolean;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

type Segment =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "math"; formula: string }
  | { kind: "cloze"; ord: number; answer: string; hint?: string };

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, index) });
    }
    if (match[1] != null) {
      segments.push({
        kind: "cloze",
        ord: Number.parseInt(match[1], 10),
        answer: match[2] ?? "",
        hint: match[3] || undefined,
      });
    } else if (match[4] != null) {
      segments.push({ kind: "bold", value: match[4] });
    } else if (match[5] != null) {
      segments.push({ kind: "math", formula: match[5] });
    } else if (match[6] != null) {
      segments.push({ kind: "math", formula: match[6].trim() });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

type ClozeLook = "blank" | "answer" | "text";

/** How one deletion draws: an empty blank, the answer in the cloze tint, or plain text. */
function clozeLook(
  ord: number,
  mode: Mode,
  activeClozeOrd: number | null | undefined,
  studyView: boolean,
): ClozeLook {
  if (mode === "list") return "blank";
  const asking = activeClozeOrd != null && activeClozeOrd > 0;
  // While one blank is asked, its siblings read as ordinary words.
  if (asking && ord !== activeClozeOrd && (studyView || mode === "hidden")) return "text";
  return mode === "hidden" ? "blank" : "answer";
}

/**
 * The asked blank: a soft accent box the same width whatever the answer, so its size
 * gives nothing away. A hint sits inside it; a number marks which blank it is when the
 * card has several. Mirrors apps/web rich-text.css `.is-hidden .dh-cloze`.
 */
function ClozeBlank({
  hint,
  number,
  fontSize,
  colors,
}: {
  hint?: string;
  number?: number;
  fontSize: number;
  colors: ThemeColors;
}) {
  const height = Math.round(fontSize * 1.0);
  const label = hint != null ? (number != null ? `${number} · ${hint}` : hint) : number;
  return (
    <View
      accessible
      accessibilityLabel={hint ? `Blank, hint: ${hint}` : "Blank"}
      style={{
        // Inline views don't grow to a minWidth inside Text, so an empty blank needs a width.
        width: hint ? undefined : Math.round(fontSize * 2.4),
        height,
        paddingHorizontal: hint ? 6 : 0,
        marginHorizontal: 2,
        borderRadius: 5,
        overflow: "hidden",
        backgroundColor: colors.accentSoft,
        alignItems: "center",
        justifyContent: "center",
        // Sits on the baseline like a word, dipping only a little into the descenders.
        transform: [{ translateY: Math.round(fontSize * 0.12) }],
      }}
    >
      {label != null ? (
        <Text
          style={{
            color: colors.accentInk,
            fontSize: Math.round(fontSize * (hint ? 0.8 : 0.62)),
            lineHeight: height - 2,
            fontWeight: hint ? "500" : "700",
            fontStyle: hint ? "italic" : "normal",
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 1.5,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}

/** Distinct deletions in the order they first appear, for a list's answer column. */
export function clozeAnswers(text: string | null | undefined): { ord: number; answer: string }[] {
  const seen = new Map<number, string[]>();
  for (const segment of parseSegments(text ?? "")) {
    if (segment.kind !== "cloze") continue;
    const answers = seen.get(segment.ord) ?? [];
    answers.push(segment.answer);
    seen.set(segment.ord, answers);
  }
  return [...seen].map(([ord, answers]) => ({ ord, answer: answers.join(" … ") }));
}

export function ClozeText({
  text,
  mode = "plain",
  activeClozeOrd,
  studyView = false,
  textStyle,
  numberOfLines,
}: Props) {
  const { colors } = useTheme();

  const flatTextStyle = StyleSheet.flatten([{ fontSize: 15, lineHeight: 22 }, textStyle]);
  const metrics = {
    fontSize: flatTextStyle.fontSize ?? 15,
    lineHeight: flatTextStyle.lineHeight ?? 22,
    fontFamily: flatTextStyle.fontFamily,
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
        },
        bold: emphasisFont(metrics.fontFamily, 600),
        // The answer put back in the blank's colours. No background: iOS paints a nested
        // Text's background from the line start once centred text wraps.
        answer: {
          ...emphasisFont(metrics.fontFamily, 600),
          color: colors.accentInk,
          textDecorationLine: "underline",
          textDecorationColor: colors.accent,
        },
      }),
    [metrics.fontSize, metrics.lineHeight, metrics.fontFamily, colors],
  );

  const segments = useMemo(() => parseSegments(text), [text]);

  if (!text || segments.length === 0) return null;

  // Numbers only help when several blanks show at once, as in a list.
  const numbered =
    mode === "list" &&
    new Set(segments.flatMap((segment) => (segment.kind === "cloze" ? [segment.ord] : []))).size > 1;

  const nodes: ReactNode[] = segments.map((segment, index) => {
    if (segment.kind === "text") {
      return segment.value;
    }

    if (segment.kind === "math") {
      return (
        <InlineMath
          key={`m-${index}`}
          formula={segment.formula}
          fontSize={metrics.fontSize}
          color={flatTextStyle.color ?? colors.fgPrimary}
        />
      );
    }

    if (segment.kind === "bold") {
      return (
        <Text key={`b-${index}`} style={styles.bold}>
          {segment.value}
        </Text>
      );
    }

    const look = clozeLook(segment.ord, mode, activeClozeOrd, studyView);
    if (look === "text") return segment.answer;
    if (look === "answer") {
      // A short answer stays on one line; a long one may wrap.
      const answer =
        segment.answer.length <= 24 ? segment.answer.replace(/ /g, "\u00A0") : segment.answer;
      return (
        <Text key={`c-${index}`} style={styles.answer}>
          {answer}
        </Text>
      );
    }
    return (
      <ClozeBlank
        key={`c-${index}`}
        hint={segment.hint}
        number={numbered ? segment.ord : undefined}
        fontSize={metrics.fontSize}
        colors={colors}
      />
    );
  });

  const mathDepth = segments.reduce(
    (deepest, segment) =>
      segment.kind === "math"
        ? Math.max(deepest, inlineMathDepth(segment.formula, metrics.fontSize))
        : deepest,
    0,
  );

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        styles.base,
        textStyle,
        mathDepth > 0 ? { paddingBottom: Math.ceil(mathDepth) } : null,
      ]}
    >
      {nodes}
    </Text>
  );
}
