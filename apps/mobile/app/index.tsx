import { Redirect } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MutedText, ScreenTitle } from "@/components/ui/text";
import { useAuth } from "@/lib/auth-context";
import { theme } from "@/lib/theme";

export default function LoginScreen() {
  const { loading, session, signInWithPassword, signInWithMagicLink, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);

  if (!loading && session) {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  async function submitPassword() {
    if (!email.trim() || !password) return;
    setBusy(true);
    const error =
      mode === "login"
        ? await signInWithPassword(email.trim(), password)
        : await signUp(email.trim(), password);
    setBusy(false);
    if (error) Alert.alert(mode === "login" ? "Sign in failed" : "Sign up failed", error);
    else if (mode === "signup") Alert.alert("Account created", "You can sign in now.");
  }

  async function submitMagicLink() {
    if (!email.trim()) return;
    setBusy(true);
    const error = await signInWithMagicLink(email.trim());
    setBusy(false);
    if (error) Alert.alert("Magic link failed", error);
    else Alert.alert("Check your email", "Tap the link to open DeepHaus.");
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <ScreenTitle>DeepHaus</ScreenTitle>
      <MutedText style={styles.subtitle}>
        Turn notes and PDFs into Anki flashcards on the go.
      </MutedText>

      <Input
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Input
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Button
        label={mode === "login" ? "Sign in" : "Create account"}
        disabled={busy || !email.trim() || !password}
        onPress={() => void submitPassword()}
      />
      <Button
        label="Send magic link"
        variant="secondary"
        disabled={busy || !email.trim()}
        onPress={() => void submitMagicLink()}
      />

      <Pressable onPress={() => setMode(mode === "login" ? "signup" : "login")}>
        <Text style={styles.link}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
    gap: 12,
    backgroundColor: theme.colors.background,
  },
  subtitle: { marginBottom: 8 },
  link: { color: theme.colors.accent, textAlign: "center", marginTop: 8 },
});
