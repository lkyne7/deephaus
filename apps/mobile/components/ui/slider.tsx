import { Host, Slider as ComposeSlider } from "@expo/ui/jetpack-compose";
import { useRef } from "react";

import { useTheme } from "@/lib/theme-context";
import type { SliderProps } from "./slider.types";

/** Material slider for whole-number values, sized by its React Native parent. */
export function Slider({ value, min, max, onChange }: SliderProps) {
  const { colors } = useTheme();
  const last = useRef(value);
  last.current = value;
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: "stretch" }}>
      <ComposeSlider
        value={value}
        min={min}
        max={max}
        // Compose counts the stops between the ends, not the values.
        steps={Math.max(0, max - min - 1)}
        colors={{ thumbColor: colors.accent, activeTrackColor: colors.accent }}
        onValueChange={(next) => {
          const rounded = Math.round(next);
          if (rounded === last.current) return;
          last.current = rounded;
          onChange(rounded);
        }}
      />
    </Host>
  );
}
