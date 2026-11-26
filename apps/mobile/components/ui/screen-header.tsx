import { router, Stack, useNavigation, type Href } from "expo-router";
import { DrawerActions } from "expo-router/react-navigation";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import type { Icon } from "@/components/ui/icon";
import {
  MenuSheet,
  isMenuGroup,
  type NativeMenuEntry,
  type NativeMenuItem,
} from "@/components/ui/menu-sheet";
import { goBackOrReplace } from "@/lib/navigation";
import { useTheme } from "@/lib/theme-context";

type AppIconName = ComponentProps<typeof Icon>["name"];
type SfIconName = ComponentProps<typeof Stack.Toolbar.Button>["icon"];

export type ScreenHeaderAction = {
  /**
   * Stable identity for a button whose label changes, so the bar updates it in
   * place instead of swapping in a new item (which re-lays out the bar).
   */
  id?: string;
  /** Icon for the Android fallback glass button. */
  icon: AppIconName;
  /** SF Symbol rendered in the native iOS navigation bar. Omit for a text button. */
  sfIcon?: SfIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  placement?: "left" | "right";
  /** The screen's main action: an accent-filled circle, like Claude's new-chat button. */
  prominent?: boolean;
};

export type ScreenHeaderMenuAction = NativeMenuItem;

export type ScreenHeaderMenu = {
  type: "menu";
  icon: AppIconName;
  sfIcon: ComponentProps<typeof Stack.Toolbar.Menu>["icon"];
  label: string;
  items: NativeMenuEntry[];
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
  /** An area's main screen: the leading button opens the app sidebar. */
  sidebar?: boolean;
};

/**
 * For lists under a search bar. The integrated bar's close button only reaches
 * JS as a blur, and sends nothing once the field has lost focus, so the keyboard
 * must stay up while searching on iOS for the query to clear on close.
 */
export const searchListKeyboardDismiss = Platform.OS === "ios" ? "none" : "on-drag";

function isMenu(
  action: ScreenHeaderAction | ScreenHeaderMenu,
): action is ScreenHeaderMenu {
  return "type" in action && action.type === "menu";
}

function renderMenuItem(item: NativeMenuItem, index: number) {
  return (
    <Stack.Toolbar.MenuAction
      key={`${index}-${item.label}`}
      icon={item.sfIcon}
      disabled={item.disabled}
      destructive={item.destructive}
      isOn={item.selected}
      onPress={item.onPress}
    >
      {item.label}
    </Stack.Toolbar.MenuAction>
  );
}

function renderMenuEntries(entries: NativeMenuEntry[]) {
  return entries.map((entry, index) =>
    isMenuGroup(entry) ? (
      <Stack.Toolbar.Menu key={entry.title ?? index} inline title={entry.title}>
        {entry.items.map(renderMenuItem)}
      </Stack.Toolbar.Menu>
    ) : (
      renderMenuItem(entry, index)
    ),
  );
}

/**
 * Screen header that uses the native iOS navigation bar: Liquid Glass back
 * button, trailing actions grouped in one glass capsule, and pull-down menus.
 * Android falls back to the custom PageHeader and a row sheet.
 */
export function ScreenHeader({ title, backFallback, actions, search, sidebar }: Props) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [androidMenu, setAndroidMenu] = useState<ScreenHeaderMenu | null>(null);
  const [searchPresented, setSearchPresented] = useState(
    Platform.OS === "ios" && Boolean(search?.autoFocus),
  );
  const searchRef = useRef<SearchBarCommands | null>(null);
  const searchFocusedRef = useRef(false);
  // The keyboard's Search key also blurs the field; that blur keeps the query.
  const searchSubmittedRef = useRef(false);

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

  const openSidebar = () => {
    Keyboard.dismiss();
    navigation.dispatch(DrawerActions.openDrawer());
  };

  if (Platform.OS === "ios") {
    const sidebarAction: ScreenHeaderAction = {
      icon: "sidebar",
      sfIcon: "line.3.horizontal",
      label: "Open menu",
      placement: "left",
      onPress: openSidebar,
    };
    // Opened cold from a link or Live Activity, a session is the first screen
    // in its stack, so there's no native back button to leave by.
    const stranded = !sidebar && backFallback != null && !navigation.canGoBack();
    const closeAction: ScreenHeaderAction = {
      icon: "close",
      sfIcon: "xmark",
      label: "Close",
      placement: "left",
      onPress: () => goBackOrReplace(backFallback ?? "/home"),
    };
    const leftActions = [
      ...(sidebar ? [sidebarAction] : []),
      ...(stranded ? [closeAction] : []),
      ...(actions?.filter((action) => action.placement === "left") ?? []),
    ];
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
        >
          {renderMenuEntries(action.items)}
        </Stack.Toolbar.Menu>
      ) : (
        <Stack.Toolbar.Button
          key={action.id ?? action.label}
          icon={action.sfIcon}
          accessibilityLabel={action.label}
          disabled={action.disabled || action.loading}
          onPress={action.onPress}
          variant={action.prominent ? "prominent" : undefined}
          tintColor={action.prominent ? colors.accent : undefined}
          separateBackground={action.prominent}
        >
          {action.sfIcon ? undefined : action.label}
        </Stack.Toolbar.Button>
      );

    const dismissSearch = () => {
      if (!search) return;
      search.onChangeText("");
      search.onCancel?.();
      setSearchPresented(false);
    };
    // A close can also come from UIKit dismissing the bar as the screen is
    // left (patches/react-native-screens: willDismissSearchController), so
    // wait a beat and only clear if this screen is still the one showing.
    const dismissSearchIfStillHere = () => {
      setTimeout(() => {
        if (navigation.isFocused()) dismissSearch();
      }, 150);
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
            // With no tab bar to sit in, it would otherwise float over the page.
            allowToolbarIntegration={false}
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
              if (searchSubmittedRef.current) {
                searchSubmittedRef.current = false;
                return;
              }
              dismissSearchIfStillHere();
            }}
            onSearchButtonPress={() => {
              searchSubmittedRef.current = true;
            }}
            onChangeText={(event) => {
              const text = event.nativeEvent.text;
              // Emptied without the keyboard up is the bar closing (see above).
              if (!text && !searchFocusedRef.current) dismissSearchIfStillHere();
              else search.onChangeText(text);
            }}
            onCancelButtonPress={dismissSearchIfStillHere}
            onClose={dismissSearchIfStillHere}
          />
        ) : null}
        {leftActions.length > 0 ? (
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
    <>
      <PageHeader
        title={title}
        onBack={!sidebar && backFallback ? () => goBackOrReplace(backFallback) : undefined}
        left={
          sidebar ? (
            <PageHeaderIconButton icon="sidebar" label="Open menu" onPress={openSidebar} />
          ) : undefined
        }
        right={
          actions && actions.length > 0
            ? actions.map((action) => (
                <PageHeaderIconButton
                  key={(!isMenu(action) && action.id) || action.label}
                  icon={action.icon}
                  label={action.label}
                  onPress={() =>
                    isMenu(action) ? setAndroidMenu(action) : action.onPress()
                  }
                  disabled={action.disabled}
                  loading={!isMenu(action) ? action.loading : false}
                />
              ))
            : undefined
        }
      />
      {androidMenu ? (
        <MenuSheet
          visible
          title={androidMenu.label}
          entries={androidMenu.items}
          onClose={() => setAndroidMenu(null)}
        />
      ) : null}
    </>
  );
}
