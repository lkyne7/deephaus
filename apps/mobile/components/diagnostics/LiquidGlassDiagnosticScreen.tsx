import Constants from "expo-constants";
import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function LiquidGlassDiagnosticScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>DEEPhAUS NATIVE DIAGNOSTIC</Text>
        <Text style={styles.title}>iOS 26 Liquid Glass</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Native glass unavailable</Text>
          <Text style={styles.body}>
            This fallback intentionally does not imitate Liquid Glass. Open this
            route on an iOS 26 device using the custom development build.
          </Text>
          <Text style={styles.detail}>Platform: {Platform.OS}</Text>
          <Text style={styles.detail}>
            Runtime: {String(Constants.executionEnvironment)}
          </Text>
          <Text style={styles.detail}>
            isGlassEffectAPIAvailable(): false
          </Text>
          <Text style={styles.detail}>isLiquidGlassAvailable(): false</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111F",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  eyebrow: {
    color: "#8BC5FF",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "800",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#101E30",
    borderColor: "#29415E",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  body: {
    color: "#B7C7D9",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
    marginTop: 8,
  },
  detail: {
    color: "#8BC5FF",
    fontFamily: "monospace",
    fontSize: 12,
    marginTop: 6,
  },
});
