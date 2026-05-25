import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sluggo — Learn More, Study Less",
  description:
    "Create and study flashcards in less time using AI-Powered Spaced Repetition that adapts to your learning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.css"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
