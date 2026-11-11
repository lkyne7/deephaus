"use client";
import { useEffect } from "react";
import posthog from "posthog-js";

// Catches errors thrown by the root layout itself, which error.tsx cannot.
// It replaces the whole document, so it renders its own <html> and <body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development",
      surface: "root",
    });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1>DeepHaus could not load</h1>
        <p>Your locally saved work is still on this device. Try again in a moment.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
