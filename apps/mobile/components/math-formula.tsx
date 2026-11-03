import { ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import { SvgXml } from "react-native-svg";
import { texToSvg } from "@/lib/math-svg";

/** MathJax's TeX font reads small beside the system font; KaTeX scales its font by 1.21 on web. */
const MATH_SCALE = 1.21;

/**
 * Points an inline formula reaches below the baseline. Text views clip inline
 * views to their own bounds, so the surrounding Text pads its bottom by this.
 */
export function inlineMathDepth(formula: string, fontSize: number): number {
  const svg = texToSvg(formula, false);
  return svg ? svg.depth * fontSize * MATH_SCALE : 0;
}

type Props = {
  formula: string;
  fontSize: number;
  color: ColorValue;
};

/**
 * Inline formula for use inside a native <Text>. iOS and Android sit inline
 * views on the baseline, so the formula is shifted down by its depth.
 */
export function InlineMath({ formula, fontSize, color }: Props) {
  const svg = texToSvg(formula, false);
  if (!svg) return <Text>{`$${formula}$`}</Text>;
  const size = fontSize * MATH_SCALE;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={formula}
      style={{
        width: svg.width * size,
        height: svg.height * size,
        transform: [{ translateY: svg.depth * size }],
      }}
    >
      <SvgXml xml={svg.xml} width="100%" height="100%" color={color as string} />
    </View>
  );
}

/** Display formula on its own line, centred; wide formulas scroll sideways. */
export function BlockMath({ formula, fontSize, color }: Props) {
  const svg = texToSvg(formula, true);
  if (!svg) {
    return <Text style={{ fontSize, color }}>{`$$${formula}$$`}</Text>;
  }
  const size = fontSize * MATH_SCALE;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.blockContent}
      accessible
      accessibilityRole="image"
      accessibilityLabel={formula}
    >
      <View style={{ width: svg.width * size, height: svg.height * size }}>
        <SvgXml xml={svg.xml} width="100%" height="100%" color={color as string} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  blockContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 4,
  },
});
