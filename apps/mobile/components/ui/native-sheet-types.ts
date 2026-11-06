import type { ReactNode } from "react";

export type SheetDetent = "medium" | "large" | { fraction: number } | { height: number };

export type NativeSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Opens at the first detent. Defaults to medium, then large. */
  detents?: SheetDetent[];
  /** Blocks swipe and backdrop dismissal, for work in progress. */
  dismissDisabled?: boolean;
  /** Replaces the close button, for example with a Save button. */
  trailing?: ReactNode;
  /** Shown in the header's leading slot. */
  leading?: ReactNode;
  hideHeader?: boolean;
  children: ReactNode;
};
