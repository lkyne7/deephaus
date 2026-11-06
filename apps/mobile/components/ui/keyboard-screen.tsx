import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

type Props = {
  children: ReactNode;
  /** Window offset of the container, for screens inside a page sheet. */
  verticalOffset?: number;
};

/**
 * Keyboard-avoiding wrapper for screens with text inputs. On iOS the
 * navigation bars are transparent and content is laid out full-bleed, so the
 * wrapper starts at the window top and needs no vertical offset; Android
 * resizes the window itself (adjustResize).
 */
export function KeyboardScreen({ children, verticalOffset = 0 }: Props) {
  if (Platform.OS !== "ios") return <>{children}</>;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={verticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
