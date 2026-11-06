import { useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "@/components/ui/brand-mark";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UIText } from "@/components/ui/text";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

export default function Reauthenticate() {
  const { user, signInWithPassword, signInWithMagicLink } = useAuth();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(magicLink = false) {
    if (!user?.email || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const error = magicLink
        ? await signInWithMagicLink(user.email)
        : await signInWithPassword(user.email, password);
      if (error) setMessage(error);
      else if (magicLink)
        setMessage("Open the sign-in link in your email on this device.");
      else {
        setPassword("");
        router.replace("/(tabs)/dashboard");
      }
    } catch {
      setMessage(
        "Could not connect. Your saved work is still on this device. Try again when online.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            gap: 12,
            padding: 24,
          }}
        >
          <View style={{ alignItems: "center", gap: 8, paddingBottom: 12 }}>
            <BrandMark size={44} style={{ marginBottom: 10 }} />
            <UIText
              variant="title"
              accessibilityRole="header"
              style={{ fontSize: 28, lineHeight: 34, letterSpacing: -0.3, textAlign: "center" }}
            >
              Reconnect your account
            </UIText>
            <UIText variant="muted" style={{ fontSize: 14, lineHeight: 20, textAlign: "center" }}>
              Sign in as {user?.email ?? "the original account"} to upload your
              saved work.
            </UIText>
          </View>
          <Field
            accessibilityLabel="Password"
            placeholder="Password"
            secureTextEntry
            textContentType="password"
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
          />
          {message && (
            <UIText accessibilityRole="alert" style={{ textAlign: "center" }}>
              {message}
            </UIText>
          )}
          <Button
            size="lg"
            label={busy ? "Connecting…" : "Sign in"}
            disabled={busy || !user?.email}
            onPress={() => void submit()}
            fullWidth
          />
          <Button
            variant="secondary"
            size="lg"
            label="Email me a sign-in link"
            disabled={busy || !user?.email}
            onPress={() => void submit(true)}
            fullWidth
          />
          <Button
            variant="tertiary"
            size="lg"
            label="Continue with downloaded library"
            onPress={() => router.replace("/(tabs)/dashboard")}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
