import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sluggo/shared", "@sluggo/apkg", "@sluggo/llm"],
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
