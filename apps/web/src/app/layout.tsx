import type { Metadata } from "next";
import Script from "next/script";
import { DevServiceWorkerCleanup } from "@/components/dev-service-worker-cleanup";
import { MotionProvider } from "@/components/motion/motion-provider";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import "./globals.css";

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
        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css"
          rel="stylesheet"
        />
        <Script id="deephaus-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body>
        <DevServiceWorkerCleanup />
        <ThemeProvider>
          <MotionProvider>{children}</MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
