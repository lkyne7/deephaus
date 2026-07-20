import path from "node:path";
import type { NextConfig } from "next";

const canvasRuntimeFiles = [
  "../../node_modules/.pnpm/@napi-rs+canvas@*/node_modules/@napi-rs/canvas/**/*",
  "../../node_modules/.pnpm/@napi-rs+canvas-linux-*@*/node_modules/@napi-rs/canvas-linux-*/*",
];

const nextConfig: NextConfig = {
  transpilePackages: ["@deephaus/shared", "@deephaus/llm", "@deephaus/rich-text"],
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "pngjs", "@napi-rs/canvas", "sql.js", "ankipack", "@open-spaced-repetition/binding", "mammoth", "jszip", "fzstd", "youtube-transcript", "tesseract.js"],
  // Required so Vercel ships sql.js's wasm + ankipack's runtime templates with
  // the API routes that build .apkg files, plus the FSRS optimizer's wasi
  // bundle for the /api/fsrs/optimize route.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/api/export": [
      "../../node_modules/.pnpm/sql.js@*/node_modules/sql.js/**/*",
      "../../node_modules/.pnpm/ankipack@*/node_modules/ankipack/**/*",
    ],
    "/api/import/anki": [
      "../../node_modules/.pnpm/sql.js@*/node_modules/sql.js/**/*",
    ],
    "/api/import/anki/prepare": [
      "../../node_modules/.pnpm/sql.js@*/node_modules/sql.js/**/*",
    ],
    "/api/import/anki/enqueue": [
      "../../node_modules/.pnpm/sql.js@*/node_modules/sql.js/**/*",
    ],
    "/api/fsrs/optimize": [
      "../../node_modules/.pnpm/@open-spaced-repetition+binding@*/node_modules/@open-spaced-repetition/binding/**/*",
    ],
    "/api/generate": canvasRuntimeFiles,
    "/api/internal/source-extraction/complete": canvasRuntimeFiles,
    "/api/sources/file": canvasRuntimeFiles,
    "/api/sources/file/from-storage": canvasRuntimeFiles,
    "/api/sources/pdf": canvasRuntimeFiles,
    "/api/sources/occlusion-scan": canvasRuntimeFiles,
    "/api/sources/preview": canvasRuntimeFiles,
    "/api/sources/[id]/document": canvasRuntimeFiles,
    "/api/cards/[id]/source": canvasRuntimeFiles,
  },
  async redirects() {
    return [
      // Sidebar-aligned route rename: /study → /decks, /decks (browse) → /cards,
      // /decks/new → /create. Keep old URLs working for bookmarks.
      { source: "/study", destination: "/decks", permanent: true },
      { source: "/decks/new", destination: "/create", permanent: true },
      { source: "/decks/new/:path*", destination: "/create/:path*", permanent: true },
      { source: "/decks/import", destination: "/create/import", permanent: true },
      { source: "/decks/import/:path*", destination: "/create/import/:path*", permanent: true },
    ];
  },
  experimental: {
    // Required for source uploads through middleware (default is 10MB).
    middlewareClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // Keep recently-visited routes in the client Router Cache so switching
    // between tabs restores instantly and revalidates in the background.
    staleTimes: {
      dynamic: 300,
      static: 600,
    },
  },
};

export default nextConfig;
