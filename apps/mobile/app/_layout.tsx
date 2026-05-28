import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";

function RootLayoutContent() {
  const { colors, colorScheme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgCanvas },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RootLayoutContent />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
