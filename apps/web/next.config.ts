import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sluggo/shared", "@sluggo/llm"],
  serverExternalPackages: ["pdf-parse", "sql.js", "ankipack", "@sluggo/apkg"],
  // Required so Vercel ships sql.js's wasm + ankipack's runtime templates with
  // the API routes that build .apkg files.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  outputFileTracingIncludes: {
    "/api/export": [
      "../../node_modules/.pnpm/sql.js@*/node_modules/sql.js/**/*",
      "../../node_modules/.pnpm/ankipack@*/node_modules/ankipack/**/*",
    ],
  },
  experimental: {
    // Required for PDF uploads through middleware (default is 10MB).
    middlewareClientMaxBodySize: "26mb",
  },
};

export default nextConfig;
