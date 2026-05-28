import { Redirect, Tabs, usePathname } from "expo-router";
import { ActivityIndicator, Platform, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

function isStudySessionPath(pathname: string) {
  return /\/study\/[^/]+$/.test(pathname);
}

export default function TabsLayout() {
  const { loading, session } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  const hideTabBar = isStudySessionPath(pathname);

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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: hideTabBar
          ? { display: "none" }
          : {
              backgroundColor: colors.bgSurface,
              borderTopColor: colors.borderSecondary,
              borderTopWidth: 1,
              paddingTop: 4,
              paddingBottom: Platform.OS === "ios" ? 24 : 8,
              height: Platform.OS === "ios" ? 84 : 64,
            },
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
  );
}
