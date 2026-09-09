import { Stack, type Href } from "expo-router";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import type { Icon } from "@/components/ui/icon";
import { goBackOrReplace } from "@/lib/navigation";
import { haptics } from "@/lib/haptics";

type AppIconName = ComponentProps<typeof Icon>["name"];
type SfIconName = ComponentProps<typeof Stack.Toolbar.Button>["icon"];

export type ScreenHeaderAction = {
  /** Icon for the Android fallback glass button. */
  icon: AppIconName;
  /** SF Symbol rendered in the native iOS navigation bar. */
  sfIcon: SfIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  placement?: "left" | "right";
};

export type ScreenHeaderMenuAction = {
  label: string;
  onPress: () => void;
  sfIcon?: ComponentProps<typeof Stack.Toolbar.MenuAction>["icon"];
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
};

export type ScreenHeaderMenu = {
  type: "menu";
  icon: AppIconName;
  sfIcon: ComponentProps<typeof Stack.Toolbar.Menu>["icon"];
  label: string;
  items: ScreenHeaderMenuAction[];
  disabled?: boolean;
  placement?: "left" | "right";
};

export type ScreenHeaderSearch = {
  placeholder: string;
  onChangeText: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
};

type Props = {
  title: string;
  /** Route used when the screen was cold deep-linked and can't pop (Android fallback header only; iOS uses the native back button). */
  backFallback?: Href;
  actions?: Array<ScreenHeaderAction | ScreenHeaderMenu>;
  /** Native UISearchController on iOS. Android screens keep their inline Field. */
  search?: ScreenHeaderSearch;
};

/**
 * Screen header that uses the native iOS navigation bar — Liquid Glass back
 * button and toolbar buttons — and falls back to the custom PageHeader on
 * Android, where the JS tab bar and headers remain in use.
 */
function isMenu(
  action: ScreenHeaderAction | ScreenHeaderMenu,
): action is ScreenHeaderMenu {
  return "type" in action && action.type === "menu";
}

function openAndroidMenu(menu: ScreenHeaderMenu) {
  Alert.alert(
    menu.label,
    undefined,
    [
      ...menu.items
        .filter((item) => !item.disabled)
        .map((item) => ({
          text: item.selected ? `✓ ${item.label}` : item.label,
          onPress: item.onPress,
          style: item.destructive
            ? ("destructive" as const)
            : ("default" as const),
        })),
      { text: "Cancel", style: "cancel" as const },
    ],
  );
}

export function ScreenHeader({ title, backFallback, actions, search }: Props) {
  const [searchPresented, setSearchPresented] = useState(
    Platform.OS === "ios" && Boolean(search?.autoFocus),
  );
  const searchRef = useRef<SearchBarCommands | null>(null);
  const searchFocusedRef = useRef(false);

  // autoFocus alone is unreliable (the bar attaches to the nav item after
  // React commits), so retry until UIKit reports focus and the keyboard is up.
  useEffect(() => {
    if (!searchPresented) return;
    searchFocusedRef.current = false;
    let attempts = 0;
    const tick = setInterval(() => {
      attempts += 1;
      if (searchFocusedRef.current || attempts > 12) {
        clearInterval(tick);
        return;
      }
      searchRef.current?.focus();
    }, 100);
    return () => clearInterval(tick);
  }, [searchPresented]);

  if (Platform.OS === "ios") {
    const leftActions = actions?.filter(
      (action) => action.placement === "left",
    );
    const rightActions = actions?.filter(
      (action) => action.placement !== "left",
    );
    const renderAction = (action: ScreenHeaderAction | ScreenHeaderMenu) =>
      isMenu(action) ? (
        <Stack.Toolbar.Menu
          key={action.label}
          icon={action.sfIcon}
          accessibilityLabel={action.label}
          disabled={action.disabled}
          separateBackground
        >
          {action.items.map((item) => (
            <Stack.Toolbar.MenuAction
              key={item.label}
              icon={item.sfIcon}
              disabled={item.disabled}
              destructive={item.destructive}
              isOn={item.selected}
              onPress={item.onPress}
            >
              {item.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      ) : (
        <Stack.Toolbar.Button
          key={action.label}
          icon={action.sfIcon}
          accessibilityLabel={action.label}
          disabled={action.disabled || action.loading}
          onPress={action.onPress}
          separateBackground
        />
      );

    const dismissSearch = () => {
      if (!search) return;
      search.onChangeText("");
      search.onCancel?.();
      setSearchPresented(false);
    };

    return (
      <>
        <Stack.Screen options={{ title }} />
        {search ? (
          // Native UISearchController, permanently mounted so UIKit accounts
          // for it in the scroll view's automatic content insets from first
          // layout (mounting it mid-session collapses the inset and content
          // slides under the field). `integratedButton` renders it as a
          // native magnifier button that expands into the field when tapped.
          <Stack.SearchBar
            ref={searchRef}
            placeholder={search.placeholder}
            placement="integratedButton"
            autoFocus={Boolean(search.autoFocus)}
            hideNavigationBar={false}
            // Results filter live as the user types, so skip the dimming
            // overlay UIKit puts over the content until text is entered.
            obscureBackground={false}
            hideWhenScrolling={false}
            onFocus={() => {
              searchFocusedRef.current = true;
              setSearchPresented(true);
            }}
            onBlur={() => {
              searchFocusedRef.current = false;
            }}
            onChangeText={(event) =>
              search.onChangeText(event.nativeEvent.text)
            }
            onCancelButtonPress={dismissSearch}
            onClose={dismissSearch}
          />
        ) : null}
        {leftActions && leftActions.length > 0 ? (
          <Stack.Toolbar placement="left">
            {leftActions.map(renderAction)}
          </Stack.Toolbar>
        ) : null}
        {rightActions && rightActions.length > 0 ? (
          <Stack.Toolbar placement="right">
            {rightActions.map(renderAction)}
          </Stack.Toolbar>
        ) : null}
      </>
    );
  }

  return (
    <PageHeader
      title={title}
      onBack={backFallback ? () => goBackOrReplace(backFallback) : undefined}
      right={
        actions && actions.length > 0
          ? actions.map((action) => (
              <PageHeaderIconButton
                key={action.label}
                icon={action.icon}
                label={action.label}
                onPress={() =>
                  isMenu(action)
                    ? openAndroidMenu(action)
                    : action.onPress()
                }
                disabled={action.disabled}
                loading={!isMenu(action) ? action.loading : false}
              />
            ))
          : undefined
      }
    />
  );
}
