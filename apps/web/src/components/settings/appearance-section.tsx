"use client";

import type { CSSProperties } from "react";
import { designColors, type DesignColorScheme } from "@deephaus/shared";
import { useTheme, type Theme } from "@/components/theme-provider";
import { CARD_FONTS, useCardFont } from "@/lib/ui/card-font";

const THEMES: Array<{ id: Theme; label: string }> = [
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
];

function ThumbArt({ scheme, className = "" }: { scheme: DesignColorScheme; className?: string }) {
  const colors = designColors[scheme];
  return (
    <span
      className={`dhs-thumb__art ${className}`}
      style={
        {
          "--thumb-canvas": colors.canvas,
          "--thumb-rail": colors.rail,
          "--thumb-ink": colors.ink,
        } as CSSProperties
      }
    >
      <span className="dhs-thumb__rail" />
      <span className="dhs-thumb__main">
        <span className="dhs-thumb__line" />
        <span className="dhs-thumb__box" />
      </span>
    </span>
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { cardFont, setCardFont } = useCardFont();

  return (
    <>
      <section className="dhs-sec">
        <h2>Color mode</h2>
        <div className="dhs-thumbs">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              className="dhs-thumb"
              aria-pressed={theme === option.id}
              onClick={() => setTheme(option.id)}
            >
              <span className={`dhs-thumb__frame${option.id === "system" ? " dhs-thumb__frame--split" : ""}`}>
                {option.id === "system" ? (
                  <>
                    <ThumbArt scheme="dark" />
                    <ThumbArt scheme="light" className="dhs-thumb__art--half" />
                  </>
                ) : (
                  <ThumbArt scheme={option.id} />
                )}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="dhs-sec">
        <h2>Card font</h2>
        <div className="dh-seg" role="group" aria-label="Card font">
          {CARD_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              aria-pressed={cardFont === font.id}
              onClick={() => setCardFont(font.id)}
            >
              {font.label}
            </button>
          ))}
        </div>
        <div className="dhs-font-sample">
          What is <b>chemiosmosis</b>?
        </div>
      </section>
    </>
  );
}
