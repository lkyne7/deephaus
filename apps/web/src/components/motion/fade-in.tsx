"use client";

import { m, useReducedMotion } from "motion/react";
import { fadeUp, motionTransition } from "@/lib/motion";

type FadeInProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
};

export function FadeIn({ children, className, style, delay = 0 }: FadeInProps) {
  const reducedMotion = useReducedMotion();

  return (
    <m.div
      className={className}
      style={style}
      variants={fadeUp}
      initial="initial"
      animate="animate"
      transition={{
        ...motionTransition(undefined, undefined, reducedMotion ?? false),
        delay: reducedMotion ? 0 : delay,
      }}
    >
      {children}
    </m.div>
  );
}
