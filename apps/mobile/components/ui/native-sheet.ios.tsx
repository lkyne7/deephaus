import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  interactiveDismissDisabled,
  preferredColorScheme,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import type { NativeSheetProps } from "@/components/ui/native-sheet-types";
import { SheetHeader } from "@/components/ui/sheet-header";
import { useTheme } from "@/lib/theme-context";

const DEFAULT_DETENTS: NativeSheetProps["detents"] = ["medium", "large"];

/** System sheet with detents and a grabber. Unmounts its content when closed. */
export function NativeSheet({
  visible,
  onClose,
  title,
  detents = DEFAULT_DETENTS,
  dismissDisabled,
  leading,
  trailing,
  hideHeader,
  children,
}: NativeSheetProps) {
  const { colors, colorScheme } = useTheme();
  return (
    <Host
      colorScheme={colorScheme}
      style={{ position: "absolute", width: 0, height: 0 }}
      pointerEvents="box-none"
    >
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(detents ?? []),
            presentationDragIndicator("visible"),
            presentationBackground(colors.bgCanvas),
            preferredColorScheme(colorScheme),
            interactiveDismissDisabled(Boolean(dismissDisabled)),
          ]}
        >
          <RNHostView>
            <View style={{ flex: 1 }}>
              {hideHeader ? null : (
                <SheetHeader
                  title={title}
                  onClose={onClose}
                  leading={leading}
                  trailing={trailing}
                  closeDisabled={dismissDisabled}
                />
              )}
              {children}
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}
