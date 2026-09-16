import { useRef, useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, Text, type TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/config";
import { useTheme } from "@/lib/theme-context";

export default function ResetPassword() {
  const { recovering, session, finishRecovery } = useAuth();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const confirmationInput = useRef<TextInput>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!recovering || !session || busy) return;
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.auth.updateUser({ password });
      if (failure) throw failure;
      setPassword("");
      setConfirm("");
      finishRecovery();
      router.replace("/(tabs)/dashboard");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update your password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bgCanvas, padding: 24 }}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingBottom: 32 }}>
        <Text
          accessibilityRole="header"
          style={{ color: colors.fgPrimary, fontSize: 26 }}
        >
          Choose a new password
        </Text>
        {!recovering || !session ? (
          <>
            <Text style={{ color: colors.fgPrimary }}>
              Open a new password reset link from your email to continue.
            </Text>
            <Button
              label="Return to sign in"
              onPress={() => router.replace("/")}
            />
          </>
        ) : (
          <>
            <Field
              accessibilityLabel="New password"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmationInput.current?.focus()}
              placeholder="New password"
              textContentType="newPassword"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />
            <Field
              accessibilityLabel="Confirm password"
              ref={confirmationInput}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              placeholder="Confirm password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="none"
            />
            {error && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.gradeAgain }}
              >
                {error}
              </Text>
            )}
            <Button
              label={busy ? "Updating…" : "Update password"}
              disabled={busy}
              onPress={() => void submit()}
            />
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
