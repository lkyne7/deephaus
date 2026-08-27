import { Button, Host } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import {
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import {
  DashboardSearchButtonFallback,
  type DashboardSearchButtonProps,
} from "@/components/dashboard/dashboard-search-button-fallback";

export function DashboardSearchButton({
  onPress,
}: DashboardSearchButtonProps) {
  const canRenderNativeGlass =
    isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

  if (!canRenderNativeGlass) {
    return <DashboardSearchButtonFallback onPress={onPress} />;
  }

  return (
    <Host matchContents>
      <Button
        label="Search"
        systemImage="magnifyingglass"
        modifiers={[
          buttonStyle("glass"),
          buttonBorderShape("circle"),
          controlSize("regular"),
          labelStyle("iconOnly"),
        ]}
        onPress={onPress}
      />
    </Host>
  );
}

export type { DashboardSearchButtonProps };
