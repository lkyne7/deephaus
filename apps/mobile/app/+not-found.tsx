import { router, Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** A stale or mistyped link (an old notification, a deleted deck) lands here, not on a router error. */
export default function NotFoundScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: "Not found", headerShown: false }} />
      <View style={styles.body}>
        <FeaturedIcon icon="search" variant="gray" size="lg" />
        <Text style={styles.title}>This page isn't here</Text>
        <Text style={styles.text}>The link may be out of date, or the deck may have been deleted.</Text>
        <Button
          variant="primary"
          size="lg"
          label="Go to Home"
          onPress={() => router.replace("/home")}
          style={styles.button}
        />
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
    title: { marginTop: 12, fontSize: 20, lineHeight: 26, fontWeight: "600", color: colors.fgPrimary },
    text: { fontSize: 15, lineHeight: 21, color: colors.fgTertiary, textAlign: "center" },
    button: { marginTop: 16, alignSelf: "stretch" },
  });
}
