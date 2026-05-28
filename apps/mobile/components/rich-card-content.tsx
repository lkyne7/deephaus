import { useMemo } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { parseCardContent } from "@deephaus/shared";
import { ClozeText } from "@/components/cloze-text";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

type Props = {
  content: string | null | undefined;
  clozeMode?: "hidden" | "revealed" | "plain";
  activeClozeOrd?: number | null;
  studyView?: boolean;
  fontScale?: number;
  style?: StyleProp<ViewStyle>;
};

export function RichCardContent({
  content,
  clozeMode = "plain",
  activeClozeOrd,
  studyView,
  fontScale = 1,
  style,
}: Props) {
  const { colors } = useTheme();
  const segments = useMemo(() => parseCardContent(content ?? ""), [content]);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: 10 },
        image: {
          width: "100%",
          height: 180,
          borderRadius: radius.xl,
          backgroundColor: colors.gray100,
        },
      }),
    [colors],
  );

  if (!content || segments.length === 0) return null;

  const baseFontSize = studyView ? 19 : 14;
  const baseLineHeight = studyView ? 30 : 20;
  const textStyle = {
    fontSize: baseFontSize * fontScale,
    lineHeight: baseLineHeight * fontScale,
    color: colors.fgPrimary,
  };

  return (
    <View style={[styles.wrap, style]}>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          segment.value ? (
            <ClozeText
              key={`t-${index}`}
              text={segment.value}
              mode={clozeMode}
              activeClozeOrd={activeClozeOrd}
              studyView={studyView}
              textStyle={textStyle}
            />
          ) : null
        ) : (
          <Image
            key={`i-${index}`}
            source={{ uri: segment.src }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={segment.alt}
          />
        ),
      )}
    </View>
  );
}
