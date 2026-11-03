import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";

export type Variant = "development" | "staging" | "production";

export interface DesktopConfig {
  variant: Variant;
  version: string;
  /** Hosted web app origin, no trailing slash. */
  origin: string;
  /** Custom URL scheme used for OAuth returns and deep links. */
  scheme: string;
  productName: string;
  appUserModelId: string;
  /** Persistent Chromium storage partition (cookies, OPFS, Cache Storage). */
  partition: string;
  /** Path the window opens on launch. */
  startPath: string;
}

/** Same hosts as apps/mobile/app.config.ts and docs/environment-release-plan.md. */
const HOSTED_ORIGINS: Record<Variant, string> = {
  production: "https://www.deephaus.ai",
  staging: "https://deephaus-staging.vercel.app",
  development: "http://localhost:3000",
};

export const SCHEMES: Record<Variant, string> = {
  production: "deephaus-desktop",
  staging: "deephaus-desktop-staging",
  development: "deephaus-desktop-dev",
};

function readPackageMetadata(): { version: string; variant?: string } {
  const file = path.join(app.getAppPath(), "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as {
    version: string;
    deephaus?: { variant?: string };
  };
  return { version: pkg.version, variant: pkg.deephaus?.variant };
}

function isVariant(value: unknown): value is Variant {
  return value === "development" || value === "staging" || value === "production";
}

export function loadConfig(): DesktopConfig {
  const pkg = readPackageMetadata();
  // Packaged builds bake the variant into package.json (electron-builder
  // extraMetadata); development reads APP_VARIANT like the mobile app does.
  const requested = app.isPackaged ? pkg.variant : process.env.APP_VARIANT ?? "development";
  const variant: Variant = isVariant(requested) ? requested : app.isPackaged ? "production" : "development";

  const override = app.isPackaged ? undefined : process.env.DEEPHAUS_DESKTOP_ORIGIN;
  const origin = (override ?? HOSTED_ORIGINS[variant]).replace(/\/+$/, "");
  if (app.isPackaged && variant === "production" && origin !== HOSTED_ORIGINS.production) {
    throw new Error("Production desktop builds must load https://www.deephaus.ai.");
  }

  return {
    variant,
    version: pkg.version,
    origin,
    scheme: SCHEMES[variant],
    productName: variant === "production" ? "DeepHaus" : variant === "staging" ? "DeepHaus Staging" : "DeepHaus Dev",
    appUserModelId: variant === "production" ? "com.deephaus.desktop" : `com.deephaus.desktop.${variant}`,
    partition: `persist:deephaus-${variant}`,
    startPath: "/dashboard",
  };
}

/** Only app-relative paths may be loaded from deep links or callbacks. */
export function safeAppPath(candidate: string | null | undefined, fallback = "/dashboard"): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  return candidate;
}
