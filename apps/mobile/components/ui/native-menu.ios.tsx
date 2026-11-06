import {
  Button,
  ContextMenu,
  Divider,
  Host,
  Menu,
  RNHostView,
  Section,
  Toggle,
} from "@expo/ui/swift-ui";
import { disabled as disabledModifier } from "@expo/ui/swift-ui/modifiers";
import { Link, router, type Href } from "expo-router";
import {
  cloneElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  isMenuGroup,
  type NativeMenuEntry,
  type NativeMenuItem,
} from "@/components/ui/menu-sheet";
import { useTheme } from "@/lib/theme-context";

export type NativeMenuProps = {
  label: string;
  message?: string;
  entries: NativeMenuEntry[];
  children: ReactNode;
  disabled?: boolean;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
};

function renderItem(item: NativeMenuItem, index: number) {
  const key = `${index}-${item.label}`;
  const modifiers = item.disabled ? [disabledModifier(true)] : undefined;
  if (item.selected !== undefined) {
    return (
      <Toggle
        key={key}
        label={item.label}
        systemImage={item.sfIcon}
        isOn={item.selected}
        onIsOnChange={() => item.onPress()}
        modifiers={modifiers}
      />
    );
  }
  return (
    <Button
      key={key}
      label={item.label}
      systemImage={item.sfIcon}
      role={item.destructive ? "destructive" : undefined}
      onPress={item.onPress}
      modifiers={modifiers}
    />
  );
}

function renderEntries(entries: NativeMenuEntry[]) {
  return entries.map((entry, index) => {
    if (!isMenuGroup(entry)) return renderItem(entry, index);
    if (entry.title) {
      return (
        <Section key={`${index}-${entry.title}`} title={entry.title}>
          {entry.items.map(renderItem)}
        </Section>
      );
    }
    return [
      index > 0 ? <Divider key={`divider-${index}`} /> : null,
      ...entry.items.map(renderItem),
    ];
  });
}

/** System pull-down menu on any React Native trigger. */
export function NativeMenu({
  label,
  entries,
  children,
  disabled,
  fill,
  style,
}: NativeMenuProps) {
  const { colorScheme } = useTheme();
  const match = fill ? { vertical: true } : true;
  return (
    <Host
      ignoreSafeArea="all"
      key={fill ? "fill" : "hug"}
      matchContents={match}
      colorScheme={colorScheme}
      style={[fill && { alignSelf: "stretch" }, style]}
    >
      <Menu
        modifiers={disabled ? [disabledModifier(true)] : undefined}
        label={
          <RNHostView matchContents={match}>
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="button"
              accessibilityLabel={label}
              style={disabled ? { opacity: 0.45 } : undefined}
            >
              {children}
            </View>
          </RNHostView>
        }
      >
        {renderEntries(entries)}
      </Menu>
    </Host>
  );
}

export type NativeContextMenuProps = {
  label: string;
  entries: NativeMenuEntry[];
  children: (trigger: { onLongPress?: () => void }) => ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * System context menu around a React Native row; taps still reach the row.
 * `ignoreSafeArea` matters: without it, a row under the tab or navigation bar
 * picks up safe area insets, and SwiftUI shifts it onto its neighbours.
 */
export function NativeContextMenu({ entries, children, style }: NativeContextMenuProps) {
  const { colorScheme } = useTheme();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setSize((prev) =>
      prev?.width === layout.width && prev.height === layout.height
        ? prev
        : { width: layout.width, height: layout.height },
    );
  };

  if (!size) {
    return (
      <View style={style} onLayout={measure}>
        {children({})}
      </View>
    );
  }
  return (
    <View style={style} onLayout={({ nativeEvent }) => {
      const { width } = nativeEvent.layout;
      setSize((prev) => (prev && prev.width !== width ? { ...prev, width } : prev));
    }}>
      <Host ignoreSafeArea="all" colorScheme={colorScheme} style={{ height: size.height }}>
        <ContextMenu>
          <ContextMenu.Items>{renderEntries(entries)}</ContextMenu.Items>
          <ContextMenu.Trigger>
            <RNHostView matchContents>
              <View
                style={{ width: size.width }}
                onLayout={({ nativeEvent }) => {
                  const { height } = nativeEvent.layout;
                  setSize((prev) => (prev && prev.height !== height ? { ...prev, height } : prev));
                }}
              >
                {children({})}
              </View>
            </RNHostView>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}

export type NativeLinkMenuProps = {
  href: Href;
  label: string;
  entries: NativeMenuEntry[];
  /** Runs before navigation. Call `event.preventDefault()` to stay on the screen. */
  onPress?: ComponentProps<typeof Link>["onPress"];
  /** The row. It receives `onPress`, so it must pass that on to its own Pressable. */
  children: ReactElement<RowProps>;
};

type RowProps = {
  onPress?: (event: GestureResponderEvent) => void;
  accessibilityActions?: Array<{ name: string; label: string }>;
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

function useScreenReaderEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setEnabled);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => subscription.remove();
  }, []);
  return enabled;
}

function renderLinkItem(item: NativeMenuItem, index: number) {
  return (
    <Link.MenuAction
      key={`${index}-${item.label}`}
      title={item.label}
      icon={item.sfIcon}
      disabled={item.disabled}
      destructive={item.destructive}
      isOn={item.selected}
      onPress={item.onPress}
    />
  );
}

/**
 * Context menu for rows that navigate, in virtualized lists. The menu attaches
 * straight to the React Native row, so no SwiftUI host is mounted per cell.
 */
export function NativeLinkMenu({ href, entries, onPress, children }: NativeLinkMenuProps) {
  const screenReader = useScreenReaderEnabled();

  // Link's trigger drops the row from the accessibility tree, so VoiceOver gets
  // the plain row with the menu as custom actions.
  if (screenReader) {
    const items = entries.flatMap((entry) => (isMenuGroup(entry) ? entry.items : [entry]));
    const enabled = items.filter((item) => !item.disabled);
    return cloneElement(children, {
      onPress: (event: GestureResponderEvent) => {
        onPress?.(event as never);
        if (!event.isDefaultPrevented()) router.push(href);
      },
      accessibilityActions: enabled.map((item) => ({ name: item.label, label: item.label })),
      onAccessibilityAction: ({ nativeEvent }: AccessibilityActionEvent) => {
        enabled.find((item) => item.label === nativeEvent.actionName)?.onPress();
      },
    });
  }

  return (
    <Link href={href} asChild onPress={onPress}>
      <Link.Trigger>{children}</Link.Trigger>
      <Link.Menu>
        {entries.map((entry, index) =>
          isMenuGroup(entry) ? (
            <Link.Menu key={index} inline title={entry.title ?? ""}>
              {entry.items.map(renderLinkItem)}
            </Link.Menu>
          ) : (
            renderLinkItem(entry, index)
          ),
        )}
      </Link.Menu>
    </Link>
  );
}
