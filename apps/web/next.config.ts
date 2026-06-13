import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@deephaus/shared", "@deephaus/llm"],
  serverExternalPackages: ["pdf-parse", "sql.js", "ankipack", "@open-spaced-repetition/binding", "mammoth", "jszip", "fzstd", "youtube-transcript", "tesseract.js"],
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
  },
  experimental: {
    // Required for source uploads through middleware (default is 10MB).
    middlewareClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // Keep recently-visited routes in the client Router Cache so switching
    // between tabs (dashboard ↔ decks ↔ study …) restores instantly and
    // revalidates in the background, instead of re-running the server render +
    // Supabase aggregations on every navigation. `dynamic` defaults to 0, which
    // is why every tab switch currently refetches from scratch.
    staleTimes: {
      dynamic: 300,
      static: 600,
    },
  },
};

export default nextConfig;
