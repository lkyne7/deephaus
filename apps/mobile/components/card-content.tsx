import { parseCardContent } from "@deephaus/shared";
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Props = {
  text: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function CardContent({ text, style, textStyle, imageStyle }: Props) {
  if (!text) return null;

  const segments = parseCardContent(text);
  if (segments.length === 0) return null;

  return (
    <View style={[styles.wrap, style]}>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          segment.value ? (
            <Text key={index} style={[styles.text, textStyle]}>
              {segment.value}
            </Text>
          ) : null
        ) : (
          <Image
            key={index}
            source={{ uri: segment.src }}
            style={[styles.image, imageStyle]}
            resizeMode="contain"
            accessibilityLabel={segment.alt}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  text: {
    color: "#e8edf4",
  },
  image: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    backgroundColor: "#0f1419",
  },
});
