import { Redirect, usePathname } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { AppSidebar, SIDEBAR_SECTIONS } from "@/components/sidebar/app-sidebar";
import { SectionScene } from "@/components/sidebar/section-scene";
import { sidebarWidth } from "@/components/sidebar/sidebar-motion";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

export const unstable_settings = {
  initialRouteName: "home",
};

const SECTION_ROOTS = new Set(SIDEBAR_SECTIONS.map((section) => `/${section.name}`));

/**
 * The signed-in app: a Claude-style sidebar over one stack per area. The
 * sidebar swipes open from anywhere on an area's main screen; pages opened
 * from a list keep their back swipe instead.
 */
export default function AppLayout() {
  const { loading, session } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: colors.bgCanvas,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    // The sidebar is only as wide as itself, but the open page's rounded
    // corners uncover the strip just past it too. Paint the whole layout in
    // the sidebar's colour so those corners show sidebar, not a lighter patch.
    <View style={{ flex: 1, backgroundColor: colors.bgRail }}>
      <Drawer
        drawerContent={(props) => <AppSidebar {...props} />}
        screenLayout={({ route, navigation, children }) => (
          <SectionScene name={route.name} navigation={navigation}>
            {children}
          </SectionScene>
        )}
        screenOptions={{
          headerShown: false,
          // As in Claude's and ChatGPT's apps, the page slides aside to uncover
          // a sidebar waiting behind it. SectionScene rounds and fades the page
          // and AppSidebar grows into place underneath (see sidebar-motion).
          drawerType: "back",
          drawerStyle: {
            width: sidebarWidth(width),
            backgroundColor: colors.bgRail,
          },
          // SectionScene fades the page inside its rounded corners; the library's
          // own overlay is square, so it stays clear (it still takes the tap
          // that closes the sidebar).
          overlayColor: "transparent",
          swipeEnabled: SECTION_ROOTS.has(pathname),
          swipeEdgeWidth: width,
          // SectionScene paints the canvas inside its rounded corners.
          sceneStyle: { backgroundColor: "transparent" },
        }}
      >
        {SIDEBAR_SECTIONS.map((section) => (
          <Drawer.Screen key={section.name} name={section.name} options={{ title: section.label }} />
        ))}
      </Drawer>
    </View>
  );
}
