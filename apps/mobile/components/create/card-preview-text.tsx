import { Text, View, type TextStyle } from "react-native";
import { RichCardContent } from "@/components/rich-card-content";
import { plainCardText } from "@/lib/card-preview";

/** TeX delimiters a card may use: $…$, $$…$$, \(…\) and \[…\]. */
const MATH = /\$[^$]+\$|\\\(|\\\[/;

/**
 * A card field in a short preview row. Plain text is clipped to a few lines;
 * text with maths is typeset, as the card browser does, in a clipped box.
 */
export function CardPreviewText({
  text,
  lines,
  style,
}: {
  text: string | null | undefined;
  lines: number;
  style: TextStyle;
}) {
  if (text && MATH.test(text)) {
    const lineHeight =
      typeof style.lineHeight === "number" ? style.lineHeight : 20;
    return (
      <View style={{ maxHeight: lineHeight * lines + 8, overflow: "hidden" }}>
        <RichCardContent content={text} imageHeight={72} textStyle={style} />
      </View>
    );
  }
  return (
    <Text style={style} numberOfLines={lines}>
      {plainCardText(text)}
    </Text>
  );
}
