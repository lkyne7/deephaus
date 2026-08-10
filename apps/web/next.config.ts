import { randomUUID } from "node:crypto";
import path from "node:path";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV === "development",
  // wa-sqlite WASM (~2.5MB) must be precached or the local database can't
  // open on a cold offline start.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Precache the offline fallback document served for uncached navigations.
  additionalPrecacheEntries: [{ url: "/~offline", revision: randomUUID() }],
});

const pdfRuntimeFiles = [
  "../../node_modules/.pnpm/@napi-rs+canvas@*/node_modules/@napi-rs/canvas/**/*",
  "../../node_modules/.pnpm/@napi-rs+canvas-*@*/node_modules/@napi-rs/canvas-*/*",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/*.mjs",
  "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/wasm/**/*",
];
const occlusionRuntimeFiles = [
  ...pdfRuntimeFiles,
  "../../node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core/**/*",
];
const universityRegistryFiles = [
  "../../node_modules/.pnpm/jbs-swot-email@*/node_modules/jbs-swot-email/data/**/*",
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
    "/api/sources/file": pdfRuntimeFiles,
    "/api/sources/file/from-storage": pdfRuntimeFiles,
    "/api/sources/pdf": pdfRuntimeFiles,
    "/api/sources/occlusion-scan": occlusionRuntimeFiles,
    "/api/sources/[id]/occlusion/auto-detect": occlusionRuntimeFiles,
    "/api/cards/[id]/occlusion/auto-detect": occlusionRuntimeFiles,
    "/api/sources/preview": pdfRuntimeFiles,
    "/api/sources/[id]/document": pdfRuntimeFiles,
    "/api/cards/[id]/source": pdfRuntimeFiles,
    "/api/profile/universities": universityRegistryFiles,
    "/api/profile/university-email/send": universityRegistryFiles,
  },
  // PowerSync web SDK (wa-sqlite) ships WASM that webpack must treat as async
  // assets. Turbopack dev uses the pre-bundled public/@powersync workers.
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
    };
    if (!isServer) {
      config.module.rules.push({
        test: /\.wasm$/,
        type: "asset/resource",
      });
    }
    return config;
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

export default withSerwist(nextConfig);
