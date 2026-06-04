import { useMemo, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { clozeHintPlaceholder } from "@deephaus/shared";
import { clozePaletteForOrd, type ClozePalette } from "@/lib/cloze-colors";
import { useTheme } from "@/lib/theme-context";

const TOKEN_PATTERN = /\{\{c(\d+)::([^:}]*)(?:::([^}]*))?\}\}|\*\*([^*]+)\*\*/g;

/** Matches apps/web rich-text.css `.dh-cloze` sizing. */
const CLOZE_RADIUS = 6;
const CLOZE_BORDER = 1;
const CLOZE_PAD_H = 6;
const CLOZE_PAD_V = 1;
const CLOZE_MARGIN_H = 1;

type Props = {
  text: string;
  mode?: "hidden" | "revealed" | "plain";
  activeClozeOrd?: number | null;
  studyView?: boolean;
  textStyle?: StyleProp<TextStyle>;
  chipStyle?: StyleProp<TextStyle>;
};

type Segment =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
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
        hint: match[3],
      });
    } else if (match[4] != null) {
      segments.push({ kind: "bold", value: match[4] });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function shouldStyleCloze(
  ord: number,
  mode: "hidden" | "revealed" | "plain",
  activeClozeOrd: number | null | undefined,
  studyView: boolean,
): boolean {
  if (studyView && activeClozeOrd != null && activeClozeOrd > 0) {
    return ord === activeClozeOrd;
  }
  if (mode === "plain" || mode === "revealed") return true;
  return mode === "hidden";
}

function clozeDisplayText(
  ord: number,
  answer: string,
  hint: string | undefined,
  mode: "hidden" | "revealed" | "plain",
  activeClozeOrd: number | null | undefined,
): string {
  if (mode === "plain" || mode === "revealed") return answer;
  const hideAll = activeClozeOrd == null || activeClozeOrd <= 0;
  if (hideAll || ord === activeClozeOrd) {
    return clozeHintPlaceholder(hint);
  }
  return answer;
}

/** Keep multi-word clozes on one highlight box when they wrap (like web box-decoration-break: clone). */
function clozeDisplayLabel(text: string): string {
  return text.replace(/ /g, "\u00A0");
}

function ClozeChip({
  label,
  palette,
  metrics,
  chipStyle,
}: {
  label: string;
  palette: ClozePalette;
  metrics: Pick<TextStyle, "fontSize" | "lineHeight">;
  chipStyle?: StyleProp<TextStyle>;
}) {
  // RN Text ignores borderRadius when borderWidth is set on a single node.
  // A nested Text "ring" reproduces the web pill: 6px radius, 1px border, clone on wrap.
  const outerRadius = CLOZE_RADIUS + CLOZE_BORDER;

  return (
    <Text
      style={{
        backgroundColor: palette.border,
        borderRadius: outerRadius,
        padding: CLOZE_BORDER,
        marginHorizontal: CLOZE_MARGIN_H,
        overflow: "hidden",
      }}
    >
      <Text
        style={[
          {
            backgroundColor: palette.bg,
            color: palette.fg,
            borderRadius: CLOZE_RADIUS,
            paddingHorizontal: CLOZE_PAD_H,
            paddingVertical: CLOZE_PAD_V,
            fontWeight: "500",
            fontSize: metrics.fontSize,
            lineHeight: metrics.lineHeight,
            overflow: "hidden",
            ...(Platform.OS === "android"
              ? { includeFontPadding: false, textAlignVertical: "center" as const }
              : null),
          },
          chipStyle,
        ]}
      >
        {label}
      </Text>
    </Text>
  );
}

export function ClozeText({
  text,
  mode = "plain",
  activeClozeOrd,
  studyView = false,
  textStyle,
  chipStyle,
}: Props) {
  const { colorScheme } = useTheme();
  const themeMode = colorScheme === "dark" ? "dark" : "light";

  const flatTextStyle = StyleSheet.flatten([{ fontSize: 15, lineHeight: 22 }, textStyle]);
  const metrics = {
    fontSize: flatTextStyle.fontSize ?? 15,
    lineHeight: flatTextStyle.lineHeight ?? 22,
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          fontSize: metrics.fontSize,
          lineHeight: metrics.lineHeight,
        },
        bold: {
          fontWeight: "700",
        },
      }),
    [metrics.fontSize, metrics.lineHeight],
  );

  const segments = useMemo(() => parseSegments(text), [text]);

  if (!text || segments.length === 0) return null;

  const nodes: ReactNode[] = segments.map((segment, index) => {
    if (segment.kind === "text") {
      return segment.value;
    }

    if (segment.kind === "bold") {
      return (
        <Text key={`b-${index}`} style={styles.bold}>
          {segment.value}
        </Text>
      );
    }

    const display = clozeDisplayText(
      segment.ord,
      segment.answer,
      segment.hint,
      mode,
      activeClozeOrd,
    );
    const styled = shouldStyleCloze(segment.ord, mode, activeClozeOrd, studyView);

    if (!styled) {
      return display;
    }

    const palette = clozePaletteForOrd(segment.ord, themeMode);
    return (
      <ClozeChip
        key={`c-${index}`}
        label={clozeDisplayLabel(display)}
        palette={palette}
        metrics={metrics}
        chipStyle={chipStyle}
      />
    );
  });

  return <Text style={[styles.base, textStyle]}>{nodes}</Text>;
}
