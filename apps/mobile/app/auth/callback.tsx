import { ActivityIndicator, View } from "react-native";
import { BrandMark } from "@/components/ui/brand-mark";
import { UIText } from "@/components/ui/text";
import { useTheme } from "@/lib/theme-context";

// AuthProvider validates and consumes the callback, including cold starts.
export default function Callback() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 32,
        backgroundColor: colors.bgCanvas,
      }}
    >
      <BrandMark size={44} />
      <UIText
        variant="subtitle"
        accessibilityRole="alert"
        style={{ fontSize: 17, lineHeight: 22, textAlign: "center" }}
      >
        Verifying your sign-in link…
      </UIText>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
