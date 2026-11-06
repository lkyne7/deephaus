import { Alert, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme-context";

const LEGAL_LINKS = [
  { label: "Privacy policy", url: "https://www.deephaus.ai/privacy" },
  { label: "Terms of use", url: "https://www.deephaus.ai/terms" },
] as const;

export function LegalLinks() {
  const { colors } = useTheme();

  async function openPage(url: string) {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert("Unable to open page", `Please visit ${url} in your browser.`);
    }
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
      {LEGAL_LINKS.map(({ label, url }) => (
        <Button
          key={url}
          label={label}
          variant="tertiary"
          size="sm"
          accessibilityRole="link"
          onPress={() => void openPage(url)}
          textStyle={{ fontSize: 13, lineHeight: 18, color: colors.fgTertiary }}
        />
      ))}
    </View>
  );
}
