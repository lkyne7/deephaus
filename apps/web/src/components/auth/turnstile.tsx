"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Cloudflare Turnstile for Supabase Auth's CAPTCHA protection. With no site key
 * configured it renders nothing and auth runs without a token, which is what
 * Supabase expects while CAPTCHA protection is off for the project.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const turnstileEnabled = TURNSTILE_SITE_KEY.length > 0;

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": (code: string) => boolean | void;
      retry?: "auto" | "never";
      "retry-interval"?: number;
      "refresh-expired"?: "auto" | "manual" | "never";
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to load")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = {
  /** Tokens are single use; call after every auth attempt. */
  reset: () => void;
};

export const Turnstile = forwardRef<
  TurnstileHandle,
  {
    onToken: (token: string | null) => void;
    /** The widget failed (it keeps retrying); `code` is Cloudflare's error code. */
    onError?: (code?: string) => void;
    className?: string;
  }
>(function Turnstile({ onToken, onError, className }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useImperativeHandle(ref, () => ({
    reset: () => {
      callbacks.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!turnstileEnabled) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "auto",
          size: "flexible",
          // Failed challenges (600xxx) and network blips retry by themselves.
          retry: "auto",
          "retry-interval": 4000,
          "refresh-expired": "auto",
          callback: (token) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "error-callback": (code) => {
            callbacks.current.onToken(null);
            callbacks.current.onError?.(code);
            // Handled: Turnstile skips its own console warning.
            return true;
          },
        });
      })
      .catch(() => callbacks.current.onError?.("script"));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  if (!turnstileEnabled) return null;
  return <div ref={container} className={className} />;
});
