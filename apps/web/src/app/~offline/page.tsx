import Link from "next/link";
import { OfflineReconnect } from "@/components/offline-reconnect";

export const metadata = {
  title: "Offline — DeepHaus",
};

/**
 * Service-worker fallback for navigations to routes that aren't cached yet.
 * Previously visited app routes render from the page cache with data served
 * by the local PowerSync replica; this page only appears for cold routes.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>You&apos;re offline</h1>
      <p style={{ maxWidth: 420, opacity: 0.75 }}>
        This page hasn&apos;t been saved on this device. Your downloaded study
        library may still be available from the dashboard. Reconnect to load
        this page.
      </p>
      <OfflineReconnect />
      <Link
        href="/dashboard"
        style={{
          marginTop: 8,
          padding: "10px 18px",
          borderRadius: 8,
          border: "1px solid currentColor",
          fontWeight: 600,
        }}
      >
        Go to dashboard
      </Link>
    </main>
  );
}
