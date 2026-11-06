import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designColors } from "@deephaus/shared";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

function block(selector: string) {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function vars(source: string) {
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

const themes = [
  ["light", vars(block(":root"))],
  ["dark", vars(block('[data-theme="dark"]'))],
] as const;

describe("design tokens", () => {
  it.each(themes)("keeps %s CSS variables in step with the shared tokens", (name, cssVars) => {
    const tokens = designColors[name];
    for (const [step, value] of Object.entries(tokens.gray)) {
      expect(cssVars[`--gray-${step}`]).toBe(value);
    }
    expect(cssVars["--bg-canvas"]).toBe(tokens.canvas);
    expect(cssVars["--bg-sidebar"]).toBe(tokens.rail);
    expect(cssVars["--bg-surface"]).toBe(tokens.surface);
    expect(cssVars["--fg-primary"]).toBe(tokens.ink);
    expect(cssVars["--hover"]).toBe(tokens.hover);
    expect(cssVars["--active"]).toBe(tokens.active);
    expect(cssVars["--border-secondary"]).toBe(tokens.line);
    expect(cssVars["--border-primary"]).toBe(tokens.lineStrong);
    expect(cssVars["--accent"]).toBe(tokens.accent);
    expect(cssVars["--accent-ink"]).toBe(tokens.accentInk);
    expect(cssVars["--accent-soft"]).toBe(tokens.accentSoft);
    expect(cssVars["--on-accent"]).toBe(tokens.onAccent);
    expect(cssVars["--due"]).toBe(tokens.due);
    expect(cssVars["--due-dot"]).toBe(tokens.dueDot);
    expect(cssVars["--danger"]).toBe(tokens.danger);
    expect(cssVars["--bg-overlay"]).toBe(tokens.scrim);
    expect(cssVars["--grade-again"]).toBe(tokens.grade.again);
    expect(cssVars["--grade-hard"]).toBe(tokens.grade.hard);
    expect(cssVars["--grade-good"]).toBe(tokens.grade.good);
    expect(cssVars["--grade-easy"]).toBe(tokens.grade.easy);
    tokens.heat.forEach((value, step) => expect(cssVars[`--heat-${step}`]).toBe(value));
    tokens.projected.forEach((value, step) => expect(cssVars[`--projected-${step + 1}`]).toBe(value));
  });

  it("keeps the no-JS dark fallback identical to the dark theme", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    const fallback = vars(media.slice(0, media.indexOf("\n  }\n")));
    expect(fallback).toEqual(vars(block('[data-theme="dark"]')));
  });
});
