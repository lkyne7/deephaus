import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

type Props = {
  children: ReactNode;
};

/**
 * Keyboard-avoiding wrapper for screens with text inputs. On iOS the
 * navigation bars are transparent and content is laid out full-bleed, so the
 * wrapper starts at the window top and needs no vertical offset; Android
 * resizes the window itself (adjustResize).
 */
export function KeyboardScreen({ children }: Props) {
  if (Platform.OS !== "ios") return <>{children}</>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}
