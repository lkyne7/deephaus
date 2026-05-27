import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { theme } from "@/lib/theme";

export default function TabsLayout() {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.muted,
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarLabel: "Home" }} />
      <Tabs.Screen name="study" options={{ title: "Study", headerShown: false }} />
      <Tabs.Screen name="create" options={{ title: "Create", headerShown: false }} />
      <Tabs.Screen name="browse" options={{ title: "Browse", headerShown: false }} />
      <Tabs.Screen name="community" options={{ title: "Community", headerShown: false }} />
    </Tabs>
  );
}
