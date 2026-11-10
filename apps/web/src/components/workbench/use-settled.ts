"use client";

import { useEffect, useState } from "react";

/** A value once it has stopped changing, so holding an arrow key doesn't fetch for every row. */
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
