"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTransition, pageFade } from "@/lib/motion";

export function AnimatedMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const isStudyPage = pathname.endsWith("/study");

  return (
    <AnimatePresence mode={isStudyPage ? "sync" : "wait"}>
      <m.div
        key={pathname}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
        variants={pageFade}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={motionTransition(0.18, undefined, reducedMotion ?? false)}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
}
