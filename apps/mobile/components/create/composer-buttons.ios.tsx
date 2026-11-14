import { Image, Text } from "@expo/ui/swift-ui";
import {
  background,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import type { ThemeColors } from "@/lib/theme";

/**
 * The composer's buttons, drawn like Claude's: flat, soft-filled circles and a
 * pill on the glass panel, with one solid send button. They are labels for
 * SwiftUI Buttons and Menus (plain style), so menus stay native.
 */
export const COMPOSER_BUTTON = 36;
const ICON = 16;

type SymbolName = ComponentProps<typeof Image>["systemName"];


/** A round, softly filled icon button. */
export function CircleLabel({
  systemName,
  colors,
  color,
  fill,
}: {
  systemName: SymbolName;
  colors: ThemeColors;
  /** Icon colour; the primary ink unless given. */
  color?: string;
  /** Circle fill; the soft warm tint unless given. */
  fill?: string;
}) {
  return (
    <Image
      systemName={systemName}
      size={ICON}
      color={color ?? colors.fgPrimary}
      modifiers={[
        frame({ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON }),
        background(fill ?? colors.bgActive, shapes.circle()),
        contentShape(shapes.circle()),
      ]}
    />
  );
}

/** A softly filled pill with a short label, like Claude's model picker. */
export function PillLabel({ text, colors }: { text: string; colors: ThemeColors }) {
  return (
    <Text
      modifiers={[
        font({ size: 15, weight: "medium" }),
        foregroundStyle(colors.fgPrimary),
        lineLimit(1),
        padding({ horizontal: 14 }),
        frame({ height: COMPOSER_BUTTON }),
        background(colors.bgActive, shapes.capsule()),
        contentShape(shapes.capsule()),
      ]}
    >
      {text}
    </Text>
  );
}
