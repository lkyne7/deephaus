import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DeepHaus",
    short_name: "DeepHaus",
    description:
      "Create and study flashcards in less time using AI-Powered Spaced Repetition that adapts to your learning.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0C0E12",
    theme_color: "#0C0E12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
