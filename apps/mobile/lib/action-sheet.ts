import { ActionSheetIOS, Alert, Platform } from "react-native";

export type ActionSheetOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Short, system-owned action choices. iOS receives a native action sheet;
 * Android uses the platform alert while complex forms remain custom sheets.
 */
export function showActionSheet(
  title: string,
  message: string | undefined,
  options: ActionSheetOption[],
) {
  if (Platform.OS === "ios") {
    const labels = [...options.map((option) => option.label), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: options
          .map((option, index) => (option.destructive ? index : -1))
          .filter((index) => index >= 0),
        disabledButtonIndices: options
          .map((option, index) => (option.disabled ? index : -1))
          .filter((index) => index >= 0),
      },
      (buttonIndex) => {
        options[buttonIndex]?.onPress();
      },
    );
    return;
  }

  Alert.alert(
    title,
    message,
    [
      ...options
        .filter((option) => !option.disabled)
        .map((option) => ({
          text: option.label,
          style: option.destructive
            ? ("destructive" as const)
            : ("default" as const),
          onPress: option.onPress,
        })),
      { text: "Cancel", style: "cancel" as const },
    ],
  );
}
