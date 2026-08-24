import type { CSSProperties } from "react";

interface BrandMarkProps {
  /** Pixel size for the rendered mark; the SVG is square. */
  size?: number;
  /** Run the equalizer loop continuously (e.g. as a loading indicator). */
  animated?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessibility label; pass `null` to leave it presentational. */
  title?: string | null;
}

/**
 * DeepHaus brand mark — a solid rounded tile with four equalizer pill bars.
 *
 * Drawn from the official logo kit SVG source. The tile fills with
 * `currentColor` and the bars with `--bg-surface`, so the mark renders as
 * the standard ink tile on light surfaces and automatically inverts to the
 * white tile on dark themes without swapping assets.
 *
 * Below 32px the small-size cut is used (thicker bars, tighter margins),
 * per the brand kit's legibility guidance.
 *
 * Motion: bars carry `dh-bar dh-bar-N` classes. Pass `animated` (or put a
 * `dh-eq` class on an ancestor) to run the equalizer loop; add `dh-eq-hover`
 * to an ancestor lockup to only equalize on hover. Keyframes live in
 * `globals.css`.
 */
export function BrandMark({ size = 28, animated = false, className, style, title = "DeepHaus" }: BrandMarkProps) {
  const small = size <= 32;
  const tile = small
    ? { x: 2, y: 2, size: 96, rx: size <= 16 ? 26 : 24 }
    : { x: 8, y: 8, size: 84, rx: 22 };
  const bars: Array<[number, number, number]> = small
    ? [
        [21, 36, 28],
        [37, 21, 58],
        [53, 29, 42],
        [69, 40, 20],
      ]
    : [
        [24, 37, 26],
        [38, 23, 54],
        [52, 30, 40],
        [66, 41, 18],
      ];
  const barWidth = small ? 11 : 10;

  return (
    <span
      className={className}
      style={{ display: "inline-flex", color: "var(--fg-primary)", ...style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden={title === null}
        role={title ? "img" : undefined}
        className={animated ? "dh-eq" : undefined}
        style={{ display: "block", color: "inherit" }}
      >
        {title ? <title>{title}</title> : null}
        <rect x={tile.x} y={tile.y} width={tile.size} height={tile.size} rx={tile.rx} fill="currentColor" />
        {bars.map(([x, y, h], i) => (
          <rect
            key={i}
            className={`dh-bar dh-bar-${i + 1}`}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={barWidth / 2}
            fill="var(--bg-surface)"
          />
        ))}
      </svg>
    </span>
  );
}

interface BrandWordmarkProps {
  /** Pixel height (font size) for the wordmark text; the tile scales with it. */
  height?: number;
  className?: string;
  style?: CSSProperties;
  title?: string | null;
}

/**
 * Full DeepHaus lock-up — tile mark + Quicksand 700 wordmark.
 *
 * The wordmark uses the `.dh-wordmark` class (Quicksand 700 with a
 * `0.033em` text-stroke so stem weight matches the tile bars at any size).
 * Inherits `--fg-primary`, so it reads correctly on light and dark themes.
 */
export function BrandWordmark({ height = 32, className, style, title = "DeepHaus" }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(height * 0.33),
        color: "var(--fg-primary)",
        ...style,
      }}
    >
      <BrandMark size={Math.round(height * 1.15)} title={title} />
      <span className="dh-wordmark" style={{ fontSize: height }}>
        DeepHaus
      </span>
    </span>
  );
}
