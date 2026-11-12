import { useState } from "react";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CaptchaPrefetch } from "@/components/auth/captcha-prefetch";
import { BrandMark } from "@/components/ui/brand-mark";
import { Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UIText } from "@/components/ui/text";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { goBackOrReplace } from "@/lib/navigation";

export default function Reauthenticate() {
  const { user, signInWithPassword, sendEmailCode, verifyEmailCode } = useAuth();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // After "Email me a code", the field takes the code instead of a password.
  const [codeSent, setCodeSent] = useState(false);
  async function submit(sendCode = false) {
    if (!user?.email || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (sendCode) {
        const error = await sendEmailCode(user.email);
        if (error) setMessage(error);
        else {
          setCodeSent(true);
          setPassword("");
          setMessage(`Enter the code we sent to ${user.email}.`);
        }
        return;
      }
      const error = codeSent
        ? await verifyEmailCode(user.email, password)
        : await signInWithPassword(user.email, password);
      if (error) setMessage(error);
      else if (!codeSent) {
        setPassword("");
        // Back to whatever you were doing (a session, a deck), not a fresh Home.
        goBackOrReplace("/home");
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
      <CaptchaPrefetch />
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
            key={codeSent ? "code" : "password"}
            accessibilityLabel={codeSent ? "Code" : "Password"}
            placeholder={codeSent ? "Code from the email" : "Password"}
            secureTextEntry={!codeSent}
            textContentType={codeSent ? "oneTimeCode" : "password"}
            keyboardType={codeSent ? "number-pad" : "default"}
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
            label={codeSent ? "Send a new code" : "Email me a code"}
            disabled={busy || !user?.email}
            onPress={() => void submit(true)}
            fullWidth
          />
          <Button
            variant="tertiary"
            size="lg"
            label="Continue with downloaded library"
            onPress={() => goBackOrReplace("/home")}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
