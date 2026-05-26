"use client";

import { usePathname } from "next/navigation";
import { m, useReducedMotion } from "motion/react";
import { motionTransition, pageFade } from "@/lib/motion";

export function AnimatedMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  return (
    <m.div
      key={pathname}
      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
      variants={pageFade}
      initial="initial"
      animate="animate"
      transition={motionTransition(0.12, undefined, reducedMotion ?? false)}
    >
      {children}
    </m.div>
  );
}
