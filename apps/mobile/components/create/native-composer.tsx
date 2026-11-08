import { forwardRef } from "react";
import type { ComposerHandle, ComposerProps } from "@/components/create/composer-types";

/** The Liquid Glass composer is iOS only; other platforms use the React Native one. */
export const NativeComposer = forwardRef<ComposerHandle, ComposerProps>(function NativeComposer() {
  return null;
});
