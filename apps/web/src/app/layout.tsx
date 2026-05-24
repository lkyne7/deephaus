import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sluggo — Anki deck generator",
  description: "Turn notes and PDFs into Anki flashcards",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
