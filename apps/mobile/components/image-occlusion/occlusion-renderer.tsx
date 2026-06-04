import {
  cardMediaDisplayUrlSized,
  enabledOcclusionRects,
  occlusionRectOrd,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { clozePaletteForOrd } from "@/lib/cloze-colors";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  data: ImageOcclusionData | null;
  activeOrd?: number | null;
  revealed?: boolean;
  studyView?: boolean;
  imageHeight?: number;
};

export function OcclusionRenderer({
  data,
  activeOrd,
  revealed = false,
  studyView = false,
  imageHeight = 220,
}: Props) {
  const { colors, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [layout, setLayout] = useState({ width: 0, height: imageHeight });

  const rects = useMemo(() => (data ? enabledOcclusionRects(data) : []), [data]);
  if (!data?.imageUrl) return null;

  const hideOrd = activeOrd != null && activeOrd > 0 ? activeOrd : null;
  const hintRects = useMemo(() => {
    if (revealed || hideOrd == null) return [];
    return rects.filter(
      (rect) => occlusionRectOrd(rect) === hideOrd && rect.label?.trim(),
    );
  }, [rects, hideOrd, revealed]);

  return (
    <View
      style={[styles.wrap, { minHeight: imageHeight }]}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setLayout({ width, height });
      }}
    >
      <Image
        source={{
          uri: cardMediaDisplayUrlSized(data.imageUrl, studyView ? "study" : "preview"),
        }}
        style={[styles.image, { height: imageHeight }]}
        resizeMode="contain"
        accessibilityLabel="Occlusion image"
      />
      {layout.width > 0 ? (
        <Svg
          style={StyleSheet.absoluteFill}
          width={layout.width}
          height={layout.height}
          pointerEvents="none"
        >
          {rects.map((rect) => {
            const ord = occlusionRectOrd(rect);
            const palette = clozePaletteForOrd(ord, colorScheme);
            const isTarget = hideOrd === ord && !revealed;
            return (
              <Rect
                key={rect.id}
                x={rect.x * layout.width}
                y={rect.y * layout.height}
                width={rect.width * layout.width}
                height={rect.height * layout.height}
                rx={6}
                fill={isTarget ? colors.gray900 : palette.bg}
                stroke={isTarget ? colors.gray900 : palette.border}
                strokeWidth={isTarget ? 2 : 2}
                fillOpacity={isTarget ? 1 : 0.85}
              />
            );
          })}
        </Svg>
      ) : null}
      {hintRects.length > 0 && layout.width > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {hintRects.map((rect) => (
            <HintOverlay key={rect.id} rect={rect} label={rect.label!.trim()} layout={layout} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HintOverlay({
  rect,
  label,
  layout,
}: {
  rect: OcclusionRect;
  label: string;
  layout: { width: number; height: number };
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: rect.x * layout.width,
        top: rect.y * layout.height,
        width: rect.width * layout.width,
        height: rect.height * layout.height,
        alignItems: "center",
        justifyContent: "center",
        padding: 4,
      }}
    >
      <Text style={hintStyles.label} numberOfLines={3}>
        {label}
      </Text>
    </View>
  );
}

const hintStyles = StyleSheet.create({
  label: {
    maxWidth: "100%",
    color: "#fff",
    backgroundColor: "rgba(16,24,40,0.78)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    overflow: "hidden",
  },
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      width: "100%",
      borderRadius: radius.xl,
      overflow: "hidden",
      backgroundColor: colors.gray100,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
    },
    image: {
      width: "100%",
    },
  });
}
