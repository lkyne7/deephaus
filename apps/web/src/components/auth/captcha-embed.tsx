"use client";

import { useEffect } from "react";
import { Turnstile, turnstileEnabled } from "@/components/auth/turnstile";

type EmbedMessage =
  | { type: "token"; token: string }
  | { type: "expired" }
  | { type: "interactive" }
  | { type: "error"; code?: string }
  | { type: "disabled" };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

function post(message: EmbedMessage) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

/**
 * The bare widget for the phone's hidden web view. Tokens go to the app via
 * postMessage; nothing here is shown to the person unless the app falls back
 * to the browser sheet.
 */
export function CaptchaEmbed() {
  useEffect(() => {
    if (!turnstileEnabled) post({ type: "disabled" });
  }, []);

  if (!turnstileEnabled) return null;
  return (
    <main style={{ padding: 8 }}>
      <Turnstile
        onToken={(token) => post(token ? { type: "token", token } : { type: "expired" })}
        onError={(code) => post({ type: "error", code })}
        onInteractive={() => post({ type: "interactive" })}
      />
    </main>
  );
}
