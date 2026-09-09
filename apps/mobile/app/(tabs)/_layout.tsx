import { Redirect, Tabs, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ActivityIndicator, Platform, View } from "react-native";
import { BackgroundTasksBanner } from "@/components/background-tasks-banner";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
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

  // iOS renders the system UITabBar, which adopts Liquid Glass on iOS 26
  // exactly like Apple's own apps — no custom glass surface needed.
  if (Platform.OS === "ios") {
    return (
      <View style={{ flex: 1 }}>
        <NativeTabs hidden={hideTabBar} tintColor={colors.brand600}>
          <NativeTabs.Trigger name="dashboard">
            <NativeTabs.Trigger.Icon
              sf={{ default: "house", selected: "house.fill" }}
            />
            <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="study">
            <NativeTabs.Trigger.Icon
              sf={{ default: "book", selected: "book.fill" }}
            />
            <NativeTabs.Trigger.Label>Study</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="create">
            <NativeTabs.Trigger.Icon
              sf={{ default: "plus.circle", selected: "plus.circle.fill" }}
            />
            <NativeTabs.Trigger.Label>Create</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="browse">
            <NativeTabs.Trigger.Icon
              sf={{ default: "folder", selected: "folder.fill" }}
            />
            <NativeTabs.Trigger.Label>Browse</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="community">
            <NativeTabs.Trigger.Icon
              sf={{ default: "person.3", selected: "person.3.fill" }}
            />
            <NativeTabs.Trigger.Label>Community</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        </NativeTabs>
        <BackgroundTasksBanner />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
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
                paddingBottom: 8,
                height: 64,
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
      </Tabs>
      <BackgroundTasksBanner />
    </View>
  );
}
