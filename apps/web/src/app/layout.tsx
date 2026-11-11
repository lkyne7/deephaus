import type { Metadata } from "next";
import Script from "next/script";
import { ConsentBanner } from "@/components/consent-banner";
import { DevServiceWorkerCleanup } from "@/components/dev-service-worker-cleanup";
import { MotionProvider } from "@/components/motion/motion-provider";
import { PostHogAuthSync } from "@/components/posthog-auth-sync";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import { cardFontInitScript } from "@/lib/ui/card-font";
import "./globals.css";
import "@/components/ui/overlays.css";

export const metadata: Metadata = {
  title: "DeepHaus — Learn More, Study Less",
  description:
    "Create and study flashcards in less time using AI-Powered Spaced Repetition that adapts to your learning.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/brand/deephaus-mark-small.svg", type: "image/svg+xml" },
    ],
    apple: "/icon-192.png",
  },
  openGraph: {
    title: "DeepHaus — Learn More, Study Less",
    description:
      "Create and study flashcards in less time using AI-Powered Spaced Repetition that adapts to your learning.",
    siteName: "DeepHaus",
    images: [{ url: "/brand/deephaus-banner.png", width: 1200, height: 630 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Linked here because Turbopack drops the remote @import in globals.css. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Quicksand:wght@600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css"
          rel="stylesheet"
        />
        <Script id="deephaus-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <Script id="deephaus-card-font-init" strategy="beforeInteractive">
          {cardFontInitScript}
        </Script>
      </head>
      <body>
        <DevServiceWorkerCleanup />
        <PostHogAuthSync />
        <ThemeProvider>
          <MotionProvider>{children}</MotionProvider>
          <ConsentBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
