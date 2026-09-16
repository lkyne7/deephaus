"use client";
import { useEffect } from "react";
import posthog from "posthog-js";
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development",
      surface: "screen",
    });
  }, [error]);
  return (
    <main style={{ padding: 32 }}>
      <h1>This screen could not load</h1>
      <p>
        Your locally saved work is still on this device. Try loading the screen
        again.
      </p>
      <button onClick={reset}>Try again</button>{" "}
      <a href="/dashboard">Go to dashboard</a>
    </main>
  );
}
