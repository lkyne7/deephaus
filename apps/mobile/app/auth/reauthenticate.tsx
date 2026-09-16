import { useState } from "react";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bgCanvas, padding: 24 }}
    >
      <View style={{ gap: 18 }}>
        <Text
          accessibilityRole="header"
          style={{ color: colors.fgPrimary, fontSize: 26 }}
        >
          Reconnect your account
        </Text>
        <Text style={{ color: colors.fgPrimary }}>
          Sign in as {user?.email ?? "the original account"} to upload your
          saved work.
        </Text>
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
          <Text accessibilityRole="alert" style={{ color: colors.fgPrimary }}>
            {message}
          </Text>
        )}
        <Button
          label={busy ? "Connecting…" : "Sign in"}
          disabled={busy || !user?.email}
          onPress={() => void submit()}
        />
        <Button
          label="Email me a sign-in link"
          disabled={busy || !user?.email}
          onPress={() => void submit(true)}
        />
        <Button
          label="Continue with downloaded library"
          onPress={() => router.replace("/(tabs)/dashboard")}
        />
      </View>
    </SafeAreaView>
  );
}
