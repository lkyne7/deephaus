import { MIN_PASSWORD_LENGTH } from "@deephaus/shared";
import { useRef, useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, type TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "@/components/ui/brand-mark";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UIText } from "@/components/ui/text";
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
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
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
      router.replace("/home");
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
              Choose a new password
            </UIText>
          </View>
          {!recovering || !session ? (
            <>
              <UIText
                variant="muted"
                style={{ fontSize: 14, lineHeight: 20, textAlign: "center" }}
              >
                Open a new password reset link from your email to continue.
              </UIText>
              <Button
                size="lg"
                label="Return to sign in"
                onPress={() => router.replace("/")}
                fullWidth
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
                <UIText
                  accessibilityRole="alert"
                  style={{ color: colors.fgError, textAlign: "center" }}
                >
                  {error}
                </UIText>
              )}
              <Button
                size="lg"
                label={busy ? "Updating…" : "Update password"}
                disabled={busy}
                onPress={() => void submit()}
                fullWidth
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
