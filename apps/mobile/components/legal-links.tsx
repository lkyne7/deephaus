import { Alert, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button } from "@/components/ui/button";

const LEGAL_LINKS = [
  { label: "Privacy policy", url: "https://www.deephaus.ai/privacy" },
  { label: "Terms of use", url: "https://www.deephaus.ai/terms" },
] as const;

export function LegalLinks() {
  async function openPage(url: string) {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert("Unable to open page", `Please visit ${url} in your browser.`);
    }
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
      {LEGAL_LINKS.map(({ label, url }) => (
        <Button
          key={url}
          label={label}
          variant="tertiary"
          size="sm"
          accessibilityRole="link"
          onPress={() => void openPage(url)}
        />
      ))}
    </View>
  );
}
