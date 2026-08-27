import { Redirect, Tabs, usePathname } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackgroundTasksBanner } from "@/components/background-tasks-banner";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { layout } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function isStudySessionPath(pathname: string) {
  // Cram session screens also hide the tab bar; other cram routes keep it.
  if (/\/study\/cram\/[^/]+\/session$/.test(pathname)) return true;
  return /\/study\/(?!cram($|\/))[^/]+$/.test(pathname);
}

export default function TabsLayout() {
  const { loading, session } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const hideTabBar = isStudySessionPath(pathname);
  const glassTabBarBottom = Math.max(8, insets.bottom - 8);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: colors.bgCanvas,
        }}
      >
        <ActivityIndicator color={colors.brand500} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: hideTabBar
            ? { display: "none" }
            : Platform.OS === "ios"
              ? {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: glassTabBarBottom,
                  marginHorizontal: layout.floatingGlassInset,
                  height: layout.floatingTabBarHeight,
                  paddingTop: 7,
                  paddingBottom: 7,
                  borderTopWidth: 0,
                  borderRadius: layout.floatingTabBarHeight / 2,
                  backgroundColor: "transparent",
                  overflow: "hidden",
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.16,
                  shadowRadius: 22,
                }
              : {
                  backgroundColor: colors.bgSurface,
                  borderTopColor: colors.borderSecondary,
                  borderTopWidth: 1,
                  paddingTop: 4,
                  paddingBottom: 8,
                  height: 64,
                },
          tabBarBackground:
            Platform.OS === "ios"
              ? () => (
                  <GlassSurface
                    fallbackColor={colors.bgSurface}
                    glassEffectStyle="regular"
                    style={[
                      StyleSheet.absoluteFill,
                      { borderRadius: layout.floatingTabBarHeight / 2 },
                    ]}
                  />
                )
              : undefined,
          tabBarActiveTintColor: colors.brand600,
          tabBarInactiveTintColor: colors.gray500,
          tabBarLabelStyle: {
            fontSize: 10,
            lineHeight: 12,
            fontWeight: "600",
            letterSpacing: 0.2,
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: "Dashboard",
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? "homeFill" : "home"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: "Study",
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? "bookFill" : "book"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: "Create",
            tabBarIcon: ({ focused, color }) => (
              <Icon
                name={focused ? "plusCircleFill" : "plusCircle"}
                size={26}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="browse"
          options={{
            title: "Browse",
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? "folderFill" : "folder"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="community"
          options={{
            title: "Community",
            tabBarIcon: ({ focused, color }) => (
              <Icon
                name={focused ? "communityFill" : "community"}
                size={24}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen name="profile" options={{ href: null, title: "Profile" }} />
      </Tabs>
      <BackgroundTasksBanner />
    </View>
  );
}
