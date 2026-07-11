"use client";

import { m, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion";

/** Scroll-triggered fade-up, used to stage landing sections as they enter the viewport. */
export function Reveal({
  children,
  className,
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
}) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <m.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 0.5, ease: [...motionTokens.easeOut], delay }}
    >
      {children}
    </m.div>
  );
}
