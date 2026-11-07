import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { motionTokens } from "@/lib/motion";

const SRC = path.resolve(__dirname, "../..");

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // The marketing site's slower scroll reveals are its own style.
    if (entry.isDirectory()) return entry.name === "landing" ? [] : stylesheets(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const globals = readFileSync(path.join(SRC, "app/globals.css"), "utf8");

function token(name: string): string {
  const match = globals.match(new RegExp(`--motion-${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--motion-${name} is missing`);
  return match[1]!.trim();
}

describe("motion tokens", () => {
  it("keeps CSS and Framer Motion on the same timing", () => {
    for (const name of ["fast", "base", "slow"] as const) {
      expect(token(name)).toBe(`${motionTokens.duration[name]}s`);
    }
    expect(token("ease")).toBe(`cubic-bezier(${motionTokens.ease.join(", ")})`);
    expect(token("ease-out")).toBe(`cubic-bezier(${motionTokens.easeOut.join(", ")})`);
  });

  it("has no hardcoded durations in app transitions", () => {
    const offenders = stylesheets(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\btransition\s*:\s*([^;}]+)/g)]
        .filter(([, value]) => /(^|[\s,])(?!0s\b)\d*\.?\d+m?s\b/.test(value!.replace(/var\([^)]*\)/g, "")))
        // A delay after a token is fine; only the duration has to be one.
        .filter(([, value]) =>
          value!.split(",").some((part) => !part.includes("var(--") && /\d+m?s\b/.test(part) && !/\s0s\b/.test(part)),
        )
        .map(([match]) => `${path.relative(SRC, file)}: ${match.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
