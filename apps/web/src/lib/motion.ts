import type { Transition, Variants } from "motion/react";

/** Mirrors the `--motion-*` properties in globals.css; a test keeps them equal. */
export const motionTokens = {
  duration: { fast: 0.1, base: 0.16, slow: 0.22 },
  ease: [0.4, 0, 0.2, 1] as const,
  easeOut: [0.16, 1, 0.3, 1] as const,
  stagger: 0.03,
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

/**
 * Card-to-card swap in the reviewers. The graded card fades out quickly while
 * the next one slides in just behind it, so there is never an empty card and
 * the two faces barely overlap. Per-state transitions live in the variants so
 * reduced motion swaps instantly.
 */
export function studyCardSwap(reducedMotion: boolean): Variants {
  if (reducedMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0 } },
      exit: { opacity: 0, transition: { duration: 0 } },
    };
  }
  return {
    initial: { opacity: 0, x: 12 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: motionTokens.duration.base, delay: 0.02, ease: [...motionTokens.easeOut] },
    },
    exit: { opacity: 0, x: -8, transition: { duration: 0.08, ease: [...motionTokens.ease] } },
  };
}
