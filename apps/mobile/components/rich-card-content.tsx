import { CardAudioPlayer } from "@/components/card-audio-player";
import { ManagedCardImage } from "@/components/managed-card-image";
import { useMemo } from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  cardMediaDisplayUrlSized,
  parseCardContent,
  type CardMediaDisplaySize,
} from "@deephaus/shared";
import { ClozeText } from "@/components/cloze-text";
import { BlockMath } from "@/components/math-formula";
import { splitMathBlocks } from "@/lib/math-svg";
import { cardFontStyle, useCardFont } from "@/lib/study/card-font";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

type Props = {
  content: string | null | undefined;
  clozeMode?: "hidden" | "revealed" | "plain";
  activeClozeOrd?: number | null;
  studyView?: boolean;
  /** Card faces share one size and colour; extras are secondary. */
  studyRole?: "face" | "extra";
  fontScale?: number;
  imageHeight?: number;
  /** Resize card-media via Supabase transforms; defaults from studyView / imageHeight. */
  mediaSize?: CardMediaDisplaySize;
  style?: StyleProp<ViewStyle>;
  /** Overrides the size derived from `studyView` / `fontScale`, e.g. to match an editor. */
  textStyle?: TextStyle;
};

export function RichCardContent({
  content,
  clozeMode = "plain",
  activeClozeOrd,
  studyView,
  studyRole = "face",
  fontScale = 1,
  imageHeight = 180,
  mediaSize: mediaSizeProp,
  style,
  textStyle: textStyleOverride,
}: Props) {
  const { colors } = useTheme();
  const cardFont = useCardFont();
  const mediaSize =
    mediaSizeProp ?? (studyView ? "study" : imageHeight <= 140 ? "browse" : "study");
  const segments = useMemo(() => parseCardContent(content ?? ""), [content]);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: 10 },
        image: {
          width: "100%",
          height: imageHeight,
          borderRadius: radius.xl,
          backgroundColor: colors.gray100,
        },
      }),
    [colors, imageHeight],
  );

  if (!content || segments.length === 0) return null;

  const studyMetrics = {
    face: { fontSize: 27, lineHeight: 35, color: colors.fgPrimary },
    extra: { fontSize: 17, lineHeight: 25, color: colors.fgTertiary },
  }[studyRole];
  const baseFontSize = studyView ? studyMetrics.fontSize : 14;
  const baseLineHeight = studyView ? studyMetrics.lineHeight : 20;
  const textStyle = {
    ...(studyView ? cardFontStyle(cardFont) : null),
    fontSize: baseFontSize * fontScale,
    lineHeight: baseLineHeight * fontScale,
    color: studyView ? studyMetrics.color : colors.fgPrimary,
    ...(studyView ? { textAlign: "center" as const } : null),
    ...textStyleOverride,
  };

  return (
    <View style={[styles.wrap, style]}>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          segment.value ? (
            <View key={`t-${index}`} style={styles.wrap}>
              {splitMathBlocks(segment.value).map((part, partIndex, parts) => {
                if (part.type === "math") {
                  return (
                    <BlockMath
                      key={`m-${partIndex}`}
                      formula={part.formula}
                      fontSize={textStyle.fontSize}
                      color={textStyle.color}
                    />
                  );
                }
                // Blank lines around media and display formulas separate markdown
                // blocks; the wrapper's gap already spaces them.
                const value = part.value.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
                if (!value.trim()) return null;
                return (
                  <ClozeText
                    key={`c-${partIndex}`}
                    text={value}
                    mode={clozeMode}
                    activeClozeOrd={activeClozeOrd}
                    studyView={studyView}
                    textStyle={textStyle}
                  />
                );
              })}
            </View>
          ) : null
        ) : segment.type === "audio" ? (
          <CardAudioPlayer
            key={`a-${index}`}
            original={segment.src}
            title={segment.title}
            fontScale={fontScale}
          />
        ) : (
          <ManagedCardImage
            key={`i-${index}`}
            original={segment.src}
            fallback={cardMediaDisplayUrlSized(segment.src, mediaSize)}
            style={[
              styles.image,
              {
                width: `${segment.displayWidth}%`,
                alignSelf: "center",
                ...(segment.aspectRatio
                  ? { height: undefined, aspectRatio: segment.aspectRatio }
                  : {}),
              },
            ]}
            contentFit="contain"
            cachePolicy="disk"
            accessibilityLabel={segment.alt}
          />
        ),
      )}
    </View>
  );
}
