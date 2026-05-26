import type { CSSProperties } from "react";

interface BrandMarkProps {
  /** Pixel size for the rendered mark; the SVG is square. */
  size?: number;
  /** Optional rounded background — when on, the mark sits on a soft surface chip. */
  chip?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessibility label; pass `null` to leave it presentational. */
  title?: string | null;
}

/**
 * DeepHaus brand mark — a flashcard outline with four waveform bars.
 *
 * Drawn from the official Claude Design source SVG (`deephaus-mark.svg`),
 * but using CSS tokens for fills + strokes so it inverts cleanly between
 * light and dark themes without swapping assets.
 *
 * - Card body fills with `--bg-surface` (white in light, near-black in dark).
 * - Outline + bars use `currentColor`, so the mark inherits the foreground
 *   color of the wrapping element. Set `color: var(--fg-primary)` on the
 *   parent (or pass a `style.color`) to control the ink tone.
 */
export function BrandMark({ size = 28, chip = false, className, style, title = "DeepHaus" }: BrandMarkProps) {
  const inner = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden={title === null}
      role={title ? "img" : undefined}
      style={{ display: "block", color: "inherit" }}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x={20}
        y={6}
        width={60}
        height={88}
        rx={12}
        fill="var(--bg-surface)"
        stroke="currentColor"
        strokeWidth={6}
      />
      <rect x={29} y={38} width={6} height={36} rx={3} fill="currentColor" />
      <rect x={41} y={26} width={6} height={48} rx={3} fill="currentColor" />
      <rect x={53} y={34} width={6} height={40} rx={3} fill="currentColor" />
      <rect x={65} y={46} width={6} height={28} rx={3} fill="currentColor" />
    </svg>
  );

  if (!chip) {
    return (
      <span className={className} style={{ display: "inline-flex", color: "var(--fg-primary)", ...style }}>
        {inner}
      </span>
    );
  }

  // Square chip variant — used in places where the mark needs a high-contrast
  // padded badge (e.g. auth card header, mobile splash). The chip itself
  // inverts colors so the mark reads against the page surface.
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 12,
        height: size + 12,
        borderRadius: 8,
        background: "var(--fg-primary)",
        color: "var(--bg-surface)",
        ...style,
      }}
    >
      {inner}
    </span>
  );
}

interface BrandWordmarkProps {
  /** Pixel height for the rendered wordmark. */
  height?: number;
  className?: string;
  style?: CSSProperties;
  title?: string | null;
}

/**
 * Full DeepHaus lock-up (mark + wordmark). Inherits color from
 * `currentColor` for the type, with the card body using `--bg-surface`,
 * so the same component looks correct on both light and dark backgrounds.
 */
export function BrandWordmark({ height = 32, className, style, title = "DeepHaus" }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", color: "var(--fg-primary)", ...style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 360 88"
        height={height}
        aria-hidden={title === null}
        role={title ? "img" : undefined}
        style={{ display: "block" }}
      >
        {title ? <title>{title}</title> : null}
        <g transform="translate(-12 4) scale(0.80)">
          <rect
            x={20}
            y={6}
            width={60}
            height={88}
            rx={12}
            fill="var(--bg-surface)"
            stroke="currentColor"
            strokeWidth={6}
          />
          <rect x={29} y={38} width={6} height={36} rx={3} fill="currentColor" />
          <rect x={41} y={26} width={6} height={48} rx={3} fill="currentColor" />
          <rect x={53} y={34} width={6} height={40} rx={3} fill="currentColor" />
          <rect x={65} y={46} width={6} height={28} rx={3} fill="currentColor" />
        </g>
        <text
          x={64}
          y={60}
          fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif"
          fontWeight={800}
          fontSize={48}
          letterSpacing={-1}
          fill="currentColor"
        >
          DeepHaus
        </text>
      </svg>
    </span>
  );
}
