import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { CAPTCHA_EMBED_URL, captchaEnabled, registerCaptchaPrefetch, reportCaptchaEvent } from "@/lib/captcha";

/**
 * Runs Cloudflare's check out of sight while a sign-in screen is open, so
 * sending a code or signing in with a password needs no browser sheet.
 * Renders nothing when CAPTCHA protection is off for this build.
 */
export function CaptchaPrefetch() {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!captchaEnabled) return;
    return registerCaptchaPrefetch(() => setGeneration((g) => g + 1));
  }, []);

  if (!captchaEnabled) return null;

  function onMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; token?: string };
      if (message.type === "token" && typeof message.token === "string") {
        reportCaptchaEvent({ type: "token", token: message.token });
      } else if (message.type === "expired" || message.type === "interactive" || message.type === "error") {
        reportCaptchaEvent({ type: message.type });
      }
    } catch {
      // Not ours.
    }
  }

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        key={generation}
        source={{ uri: CAPTCHA_EMBED_URL }}
        onMessage={onMessage}
        // Cloudflare's mobile guidance: JavaScript, DOM storage and the default
        // data store on, and the system user agent left alone.
        javaScriptEnabled
        domStorageEnabled
        incognito={false}
        onError={() => reportCaptchaEvent({ type: "error" })}
        onHttpError={() => reportCaptchaEvent({ type: "error" })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen but laid out at a real size; zero-sized views can stall the widget.
  hidden: { position: "absolute", left: -1000, top: 0, width: 320, height: 80, opacity: 0 },
});
