import { Redirect, usePathname } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { AppSidebar, SIDEBAR_SECTIONS } from "@/components/sidebar/app-sidebar";
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
    <Drawer
      drawerContent={(props) => <AppSidebar {...props} />}
      screenOptions={{
        headerShown: false,
        // The page slides aside with the sidebar, as in Claude's app.
        drawerType: "slide",
        drawerStyle: {
          width: Math.min(Math.round(width * 0.84), 340),
          backgroundColor: colors.bgRail,
        },
        overlayColor: colors.bgOverlay,
        swipeEnabled: SECTION_ROOTS.has(pathname),
        swipeEdgeWidth: width,
        sceneStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      {SIDEBAR_SECTIONS.map((section) => (
        <Drawer.Screen key={section.name} name={section.name} options={{ title: section.label }} />
      ))}
    </Drawer>
  );
}
