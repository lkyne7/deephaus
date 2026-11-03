// Build the main/preload bundles and launch Electron against a web origin.
//
//   pnpm --filter @deephaus/desktop dev                   → http://localhost:3000 (pnpm dev:web)
//   DEEPHAUS_DESKTOP_ORIGIN=https://deephaus-staging.vercel.app pnpm --filter @deephaus/desktop dev
//
// Service workers are disabled in `next dev`, so offline behaviour needs a
// production web build (`next build && next start`) or hosted staging.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electron = require("electron");

const build = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

// ELECTRON_RUN_AS_NODE (set by some editors and agent hosts) would start plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...baseEnv } = process.env;
const env = {
  ...baseEnv,
  APP_VARIANT: process.env.APP_VARIANT ?? "development",
  DEEPHAUS_DESKTOP_ORIGIN: process.env.DEEPHAUS_DESKTOP_ORIGIN ?? "http://localhost:3000",
};

const run = spawnSync(electron, [root], { cwd: root, stdio: "inherit", env });
process.exit(run.status ?? 0);
