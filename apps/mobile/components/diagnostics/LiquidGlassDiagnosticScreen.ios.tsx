import { Button, Host } from "@expo/ui/swift-ui";
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function LiquidGlassDiagnosticScreen() {
  const glassEffectAPIAvailable = isGlassEffectAPIAvailable();
  const liquidGlassAvailable = isLiquidGlassAvailable();
  const canRenderGlass = glassEffectAPIAvailable && liquidGlassAvailable;
  const [reduceTransparencyEnabled, setReduceTransparencyEnabled] =
    useState<boolean | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(
      setReduceTransparencyEnabled,
    );

    console.log("[LiquidGlassDiagnostic]", {
      executionEnvironment: Constants.executionEnvironment,
      glassEffectAPIAvailable,
      liquidGlassAvailable,
    });
  }, [glassEffectAPIAvailable, liquidGlassAvailable]);

  useEffect(() => {
    if (reduceTransparencyEnabled === null) return;
    console.log("[LiquidGlassDiagnostic] reduceTransparencyEnabled:", reduceTransparencyEnabled);
  }, [reduceTransparencyEnabled]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>DEEPhAUS NATIVE DIAGNOSTIC</Text>
        <Text style={styles.title}>iOS 26 Liquid Glass</Text>
        <Text style={styles.intro}>
          Every glass sample on this screen is an Apple native view. No blur,
          translucent fill, border, shadow, or opacity-based imitation is used.
        </Text>

        <View style={styles.statusCard}>
          <StatusRow
            label="isGlassEffectAPIAvailable()"
            value={glassEffectAPIAvailable}
          />
          <StatusRow
            label="isLiquidGlassAvailable()"
            value={liquidGlassAvailable}
          />
          <StatusRow
            label="Reduce Transparency"
            value={reduceTransparencyEnabled}
          />
          <View style={styles.runtimeRow}>
            <Text style={styles.statusLabel}>Runtime</Text>
            <Text style={styles.runtimeValue}>
              {String(Constants.executionEnvironment)}
            </Text>
          </View>
        </View>

        {canRenderGlass ? (
          <>
            <Text style={styles.sectionTitle}>Native SwiftUI buttons</Text>
            <View style={styles.buttonStage}>
              <View style={styles.stageShapeLarge} />
              <View style={styles.stageShapeSmall} />
              <View style={styles.nativeButtonRow}>
                <Host matchContents>
                  <Button
                    label="Add"
                    systemImage="plus"
                    modifiers={[
                      buttonStyle("glass"),
                      buttonBorderShape("circle"),
                      controlSize("large"),
                      labelStyle("iconOnly"),
                    ]}
                    onPress={() =>
                      console.log("[LiquidGlassDiagnostic] glass button pressed")
                    }
                  />
                </Host>
                <Host matchContents>
                  <Button
                    label="Continue"
                    systemImage="arrow.right"
                    modifiers={[
                      buttonStyle("glassProminent"),
                      buttonBorderShape("capsule"),
                      controlSize("large"),
                    ]}
                    onPress={() =>
                      console.log(
                        "[LiquidGlassDiagnostic] glassProminent button pressed",
                      )
                    }
                  />
                </Host>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Native GlassView</Text>
            <View style={styles.glassStage}>
              <View style={styles.glassBackdropLeft} />
              <View style={styles.glassBackdropRight} />
              <GlassView
                glassEffectStyle="regular"
                isInteractive
                style={styles.glassPanel}
              >
                <Text style={styles.glassPanelTitle}>UIVisualEffectView</Text>
                <Text style={styles.glassPanelBody}>
                  Interactive native regular glass
                </Text>
              </GlassView>
            </View>

            <Text style={styles.sectionTitle}>Native GlassContainer</Text>
            <View style={styles.containerStage}>
              <View style={styles.containerBackdrop} />
              <GlassContainer spacing={18} style={styles.glassContainer}>
                <GlassView
                  glassEffectStyle="clear"
                  isInteractive
                  style={styles.glassCircleLarge}
                />
                <GlassView
                  glassEffectStyle="regular"
                  style={styles.glassCircleMedium}
                />
                <GlassView
                  glassEffectStyle="clear"
                  style={styles.glassCircleSmall}
                />
              </GlassContainer>
            </View>
          </>
        ) : (
          <View style={styles.unavailableCard}>
            <Text style={styles.unavailableTitle}>Native glass unavailable</Text>
            <Text style={styles.unavailableBody}>
              Use an iOS 26 device and a fresh development build compiled with
              Xcode 26. Do not substitute a styled React Native view.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusRow({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  const displayValue = value === null ? "checking…" : String(value);

  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text
        style={[
          styles.statusValue,
          value === true && styles.statusTrue,
          value === false && styles.statusFalse,
        ]}
      >
        {displayValue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111F",
  },
  content: {
    padding: 24,
    paddingBottom: 56,
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
  intro: {
    color: "#B7C7D9",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  statusCard: {
    backgroundColor: "#101E30",
    borderColor: "#29415E",
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginTop: 24,
    padding: 16,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  runtimeRow: {
    borderTopColor: "#29415E",
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 12,
  },
  statusLabel: {
    color: "#D7E2EE",
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  statusValue: {
    color: "#C3D1DF",
    fontFamily: "Courier",
    fontSize: 13,
    marginLeft: 12,
  },
  runtimeValue: {
    color: "#8BC5FF",
    fontFamily: "Courier",
    fontSize: 12,
  },
  statusTrue: {
    color: "#63E6A6",
  },
  statusFalse: {
    color: "#FF8B8B",
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    marginTop: 28,
  },
  buttonStage: {
    alignItems: "center",
    backgroundColor: "#284E79",
    borderRadius: 24,
    height: 160,
    justifyContent: "center",
    overflow: "hidden",
  },
  stageShapeLarge: {
    backgroundColor: "#FF8A4C",
    borderRadius: 55,
    height: 110,
    left: 30,
    position: "absolute",
    top: 20,
    width: 110,
  },
  stageShapeSmall: {
    backgroundColor: "#7A5CFF",
    borderRadius: 34,
    bottom: 12,
    height: 68,
    position: "absolute",
    right: 35,
    width: 68,
  },
  nativeButtonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 18,
  },
  glassStage: {
    backgroundColor: "#1A3658",
    borderRadius: 24,
    height: 190,
    justifyContent: "center",
    overflow: "hidden",
    padding: 24,
  },
  glassBackdropLeft: {
    backgroundColor: "#00AFC7",
    borderRadius: 60,
    height: 120,
    left: -10,
    position: "absolute",
    top: 18,
    width: 120,
  },
  glassBackdropRight: {
    backgroundColor: "#FF4D8D",
    borderRadius: 48,
    bottom: 4,
    height: 96,
    position: "absolute",
    right: 12,
    width: 96,
  },
  glassPanel: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: 22,
    height: 112,
    justifyContent: "center",
    padding: 18,
  },
  glassPanelTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  glassPanelBody: {
    color: "#FFFFFF",
    fontSize: 13,
    marginTop: 5,
  },
  containerStage: {
    alignItems: "center",
    backgroundColor: "#3A2459",
    borderRadius: 24,
    height: 150,
    justifyContent: "center",
    overflow: "hidden",
  },
  containerBackdrop: {
    backgroundColor: "#FFB21C",
    height: 34,
    position: "absolute",
    transform: [{ rotate: "-12deg" }],
    width: 320,
  },
  glassContainer: {
    alignItems: "center",
    flexDirection: "row",
    height: 90,
    justifyContent: "center",
    width: 250,
  },
  glassCircleLarge: {
    borderRadius: 34,
    height: 68,
    width: 68,
  },
  glassCircleMedium: {
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  glassCircleSmall: {
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  unavailableCard: {
    backgroundColor: "#241B24",
    borderColor: "#704553",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 28,
    padding: 18,
  },
  unavailableTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  unavailableBody: {
    color: "#DEC7CF",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
});
