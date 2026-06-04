import type { CSSProperties } from "react";

type SkeletonBarProps = {
  width?: string | number;
  height?: number;
  radius?: number;
  className?: string;
  style?: CSSProperties;
};

/** Horizontal shimmer placeholder (content-loading pattern). */
export function SkeletonBar({
  width = "100%",
  height = 12,
  radius = 6,
  className = "skeleton-bar",
  style,
}: SkeletonBarProps) {
  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

type SkeletonBlockProps = {
  children?: React.ReactNode;
  style?: CSSProperties;
  className?: string;
};

export function SkeletonBlock({ children, style, className }: SkeletonBlockProps) {
  return (
    <div className={className} style={style} aria-busy aria-label="Loading">
      {children}
    </div>
  );
}
