import { Button, Capsule, Host, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { GradeButtonProps } from "@/components/study/grade-button";
import { useTheme } from "@/lib/theme-context";

/** SwiftUI's stand-in for double.infinity: bigger than any dock slot. */
const FILL = 100_000;

/** System button with a stacked label, sized by the dock's row. */
export function GradeButton({ label, interval, color, onPress }: GradeButtonProps) {
  const { colors, colorScheme } = useTheme();

  return (
    <Host ignoreSafeArea="all" colorScheme={colorScheme} style={{ flex: 1 }}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle("plain"),
          accessibilityLabel(`Grade ${label}, next review ${interval}`),
        ]}
      >
        <VStack
          spacing={0}
          modifiers={[
            frame({ maxWidth: FILL, maxHeight: FILL }),
            // A plain button only hit-tests its drawn content without this.
            contentShape(shapes.rectangle()),
          ]}
        >
          <Text modifiers={[font({ size: 15, weight: "medium" }), foregroundStyle(colors.fgPrimary)]}>
            {label}
          </Text>
          <Text
            modifiers={[
              font({ size: 12 }),
              foregroundStyle(colors.fgTertiary),
              lineLimit(1),
              minimumScaleFactor(0.8),
              padding({ top: 2 }),
            ]}
          >
            {interval}
          </Text>
          <Capsule
            modifiers={[frame({ width: 18, height: 2 }), foregroundStyle(color), padding({ top: 6 })]}
          />
        </VStack>
      </Button>
    </Host>
  );
}
