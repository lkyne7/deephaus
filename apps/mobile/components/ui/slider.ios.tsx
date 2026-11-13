import { Host, Slider as SwiftSlider } from "@expo/ui/swift-ui";
import { accessibilityLabel as accessibilityLabelModifier, tint } from "@expo/ui/swift-ui/modifiers";
import { useRef } from "react";

import { useTheme } from "@/lib/theme-context";
import type { SliderProps } from "./slider.types";

/** System slider for whole-number values, sized by its React Native parent. */
export function Slider({ value, min, max, onChange, accessibilityLabel }: SliderProps) {
  const { colors, colorScheme } = useTheme();
  const last = useRef(value);
  last.current = value;
  return (
    <Host
      ignoreSafeArea="all"
      matchContents={{ vertical: true }}
      colorScheme={colorScheme}
      style={{ alignSelf: "stretch" }}
    >
      <SwiftSlider
        value={value}
        min={min}
        max={max}
        step={1}
        onValueChange={(next) => {
          const rounded = Math.round(next);
          if (rounded === last.current) return;
          last.current = rounded;
          onChange(rounded);
        }}
        modifiers={[
          tint(colors.accent),
          ...(accessibilityLabel ? [accessibilityLabelModifier(accessibilityLabel)] : []),
        ]}
      />
    </Host>
  );
}
