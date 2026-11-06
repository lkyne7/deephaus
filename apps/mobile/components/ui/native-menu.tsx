import { router, type Href, type Link } from "expo-router";
import {
  cloneElement,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { MenuSheet, type NativeMenuEntry } from "@/components/ui/menu-sheet";

export type NativeMenuProps = {
  /** Accessibility label for the trigger and title of the Android sheet. */
  label: string;
  message?: string;
  entries: NativeMenuEntry[];
  /** The trigger. Rendered as is; it should not handle presses itself. */
  children: ReactNode;
  disabled?: boolean;
  /** Stretch the trigger to the available width. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Pull-down menu. iOS draws the system menu; Android opens a row sheet. */
export function NativeMenu({
  label,
  message,
  entries,
  children,
  disabled,
  fill,
  style,
}: NativeMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[fill && { alignSelf: "stretch" }, style]}
      >
        {children}
      </Pressable>
      <MenuSheet
        visible={open}
        title={label}
        message={message}
        entries={entries}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export type NativeContextMenuProps = {
  /** Sheet title on Android. */
  label: string;
  entries: NativeMenuEntry[];
  /**
   * The row. On Android it receives the long-press handler to pass to its own
   * Pressable; iOS opens the system context menu and passes nothing.
   */
  children: (trigger: { onLongPress?: () => void }) => ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Long-press menu for list rows. */
export function NativeContextMenu({ label, entries, children }: NativeContextMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children({ onLongPress: () => setOpen(true) })}
      <MenuSheet
        visible={open}
        title={label}
        entries={entries}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export type NativeLinkMenuProps = {
  href: Href;
  label: string;
  entries: NativeMenuEntry[];
  /** Runs before navigation. Call `event.preventDefault()` to stay on the screen. */
  onPress?: ComponentProps<typeof Link>["onPress"];
  /** The row. It receives `onPress` and `onLongPress` for its own Pressable. */
  children: ReactElement<{
    onPress?: (event: GestureResponderEvent) => void;
    onLongPress?: () => void;
  }>;
};

/** Long-press menu for rows that navigate. iOS attaches it through expo-router's Link. */
export function NativeLinkMenu({ href, label, entries, onPress, children }: NativeLinkMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {cloneElement(children, {
        onPress: (event: GestureResponderEvent) => {
          onPress?.(event as never);
          if (!event?.isDefaultPrevented?.()) router.push(href);
        },
        onLongPress: () => setOpen(true),
      })}
      <MenuSheet
        visible={open}
        title={label}
        entries={entries}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
