"use client";

import { m, useReducedMotion } from "motion/react";
import { staggerContainer, staggerItem, motionTransition } from "@/lib/motion";

type StaggerListProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "ul" | "ol";
};

export function StaggerList({ children, className, style, as = "div" }: StaggerListProps) {
  const reducedMotion = useReducedMotion();
  const Component = m[as];

  return (
    <Component
      className={className}
      style={style}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      transition={motionTransition(undefined, undefined, reducedMotion ?? false)}
    >
      {children}
    </Component>
  );
}

type StaggerItemProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "li";
};

export function StaggerItem({ children, className, style, as = "div" }: StaggerItemProps) {
  const Component = m[as];

  return (
    <Component className={className} style={style} variants={staggerItem}>
      {children}
    </Component>
  );
}
