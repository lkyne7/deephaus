import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

// SharedWorker startup needs the browser's HTTP cache on a cold offline open.
// Give its otherwise unversioned entry point a content hash before serving it
// with immutable caching. SDK chunk/wasm filenames already contain hashes.
const powerSyncWorker = path.join(__dirname, "public/@powersync/worker.js");
const powerSyncWorkerName = `worker-${createHash("sha256").update(readFileSync(powerSyncWorker)).digest("hex").slice(0, 16)}.js`;
copyFileSync(powerSyncWorker, path.join(__dirname, "public/@powersync", powerSyncWorkerName));

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
  env: { NEXT_PUBLIC_POWERSYNC_WORKER_PATH: `/@powersync/${powerSyncWorkerName}` },
  async headers() {
    return [
      { source: "/@powersync/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // Older clients use this unversioned name and must still see SDK upgrades.
      { source: "/@powersync/worker.js", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
    ];
  },
  // Staging journeys and build checks must not overwrite the active simulator's
  // local API build artifacts. The launch runner sets a separate directory.
  distDir: process.env.DEEPHAUS_LAUNCH_ENV
    ? process.env.DEEPHAUS_LAUNCH_NETWORK_ONLY === "1" ? ".next-launch-network" : ".next-launch"
    : ".next",
  typescript: process.env.DEEPHAUS_LAUNCH_ENV
    ? { tsconfigPath: "tsconfig.launch.json" }
    : undefined,
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
  // PostHog ingestion is reverse-proxied through /ingest so analytics
  // requests are first-party and survive ad-blockers.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
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
