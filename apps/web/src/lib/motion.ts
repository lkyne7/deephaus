import type { Transition, Variants } from "motion/react";

export const motionTokens = {
  duration: { fast: 0.18, base: 0.24, slow: 0.32 },
  ease: [0.4, 0, 0.2, 1] as const,
  easeOut: [0.16, 1, 0.3, 1] as const,
  stagger: 0.04,
} as const;

export function motionTransition(
  duration: number = motionTokens.duration.base,
  ease: readonly [number, number, number, number] = motionTokens.easeOut,
  reducedMotion?: boolean,
): Transition {
  if (reducedMotion) return { duration: 0 };
  return { duration, ease: [...ease] as [number, number, number, number] };
}

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

export const slideLeft: Variants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: motionTokens.stagger },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

export const pageFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};
