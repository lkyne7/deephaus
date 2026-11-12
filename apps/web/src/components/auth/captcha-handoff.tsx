"use client";

import { useState } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Turnstile, turnstileEnabled } from "@/components/auth/turnstile";
import { captchaReturnUrl, isCaptchaReturnUrl } from "@/lib/captcha-return";

export function CaptchaHandoff({ returnTo }: { returnTo: string }) {
  const [error, setError] = useState<string | null>(
    isCaptchaReturnUrl(returnTo) ? null : "Open this page from the DeepHaus app.",
  );

  if (!turnstileEnabled) {
    return (
      <AuthLayout title="Security check" subtitle="No check is needed right now. Return to the app.">
        {null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Quick security check" subtitle="This keeps automated sign-ups out. You'll return to the app.">
      {error ? <div className="notice notice-error">{error}</div> : null}
      {isCaptchaReturnUrl(returnTo) ? (
        <Turnstile
          onToken={(token) => {
            const target = token ? captchaReturnUrl(returnTo, token) : null;
            if (target) window.location.href = target;
          }}
          onError={() => setError("The security check didn't finish and is retrying. If it keeps failing, close this and try again.")}
        />
      ) : null}
    </AuthLayout>
  );
}
