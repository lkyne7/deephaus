"use client";

/**
 * Plain layout wrapper for the app shell.
 *
 * We intentionally do NOT animate page transitions or key by pathname here.
 * Keying by pathname forces a full unmount/remount of every route on every
 * navigation, which re-runs all motion children (stat cards, donut chart,
 * deck stagger list, etc.) and made route changes feel sticky. Next's
 * App Router handles the child swap; the underlying pages do their own
 * fade-ins via <FadeIn> where appropriate.
 */
export function AnimatedMain({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}
