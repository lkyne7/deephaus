import { MIN_PASSWORD_LENGTH } from "@deephaus/shared";
import { Redirect } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "@/components/ui/brand-mark";
import { LegalLinks } from "@/components/legal-links";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { posthog } from "@/lib/posthog";
import { serifFont } from "@/lib/fonts";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Mode = "splash" | "login" | "signup";

export default function AuthGate() {
  const { loading, session, recovering } = useAuth();
  const [mode, setMode] = useState<Mode>("splash");

  if (recovering) return <Redirect href="/auth/reset-password" />;

  if (!loading && session) {
    return <Redirect href="/home" />;
  }

  if (mode === "splash") {
    return <SplashView onLogin={() => setMode("login")} onSignup={() => setMode("signup")} />;
  }

  return <AuthForm mode={mode} onChangeMode={setMode} />;
}

function SplashView({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.splashRoot}>
      <View style={styles.splashHero}>
        <BrandMark size={88} />
        <Text style={styles.splashTitle}>Learn more,{"\n"}study less.</Text>
        <Text style={styles.splashCopy}>
          AI-powered flashcards that adapt to how you remember.
        </Text>
      </View>

      <View style={styles.splashActions}>
        <Button
          variant="primary"
          size="xl"
          label="Get started"
          trailingIcon="arrowRight"
          onPress={onSignup}
          fullWidth
        />
        <Button
          variant="tertiary"
          size="xl"
          label="I already have an account"
          onPress={onLogin}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

function AuthForm({
  mode,
  onChangeMode,
}: {
  mode: "login" | "signup";
  onChangeMode: (mode: Mode) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signInWithPassword, signInWithMagicLink, signInWithProvider, resetPassword, signUp } =
    useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordInput = useRef<TextInput>(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<"google" | "apple" | null>(null);

  const isLogin = mode === "login";
  const googleLabel = socialBusy === "google" ? "Connecting…" : "Continue with Google";
  const appleLabel = socialBusy === "apple" ? "Connecting…" : "Continue with Apple";

  async function submit() {
    if (busy || socialBusy || !email.trim() || !password) return;
    setBusy(true);
    try {
      if (isLogin) {
        const error = await signInWithPassword(email.trim(), password);
        if (error) Alert.alert("Sign in failed", error);
        else posthog.capture("user_signed_in", { method: "password" });
      } else {
        const result = await signUp(email.trim(), password, name.trim());
        if (result.error) {
          Alert.alert("Sign up failed", result.error);
          return;
        }
        // Confirmed accounts are counted when their link reaches the auth callback.
        if (result.needsConfirmation) {
          Alert.alert("Check your email", "Confirm your account using the link we sent, then return to DeepHaus to sign in.");
          onChangeMode("login");
        } else {
          posthog.capture("user_signed_up", { method: "password" });
        }
      }
    } catch (error) {
      Alert.alert(isLogin ? "Sign in failed" : "Sign up failed", error instanceof Error ? error.message : "Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    if (busy || socialBusy || !email.trim()) return;
    setBusy(true);
    try {
      const error = await signInWithMagicLink(email.trim());
      if (error) Alert.alert("Magic link failed", error);
      else Alert.alert("Check your email", "Tap the link to open DeepHaus.");
    } catch {
      Alert.alert("Magic link failed", "Please check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function forgotPassword() {
    if (busy || socialBusy) return;
    if (!email.trim()) {
      Alert.alert("Enter your email", "Type your email above, then tap Forgot password again.");
      return;
    }
    setBusy(true);
    try {
      const error = await resetPassword(email.trim());
      if (error) Alert.alert("Reset failed", error);
      else Alert.alert("Check your email", "We sent a link to reset your password.");
    } catch {
      Alert.alert("Reset failed", "Please check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function socialSignIn(provider: "google" | "apple") {
    if (busy || socialBusy) return;
    setSocialBusy(provider);
    try {
      const error = await signInWithProvider(provider);
      if (error && error !== "Sign in was canceled.") Alert.alert("Sign in failed", error);
    } catch {
      Alert.alert("Sign in failed", "Please check your connection and try again.");
    } finally { setSocialBusy(null); }
  }

  return (
    <SafeAreaView style={styles.authRoot}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
        >
          <Button
            variant="secondary"
            size="lg"
            pill
            iconOnly
            leadingIcon="arrowLeft"
            accessibilityLabel="Back"
            onPress={() => onChangeMode("splash")}
            style={styles.backBtn}
          />

          <View style={styles.authBrand}>
            <BrandMark size={44} />
          </View>

          <View style={styles.authHeader}>
            <Text style={styles.authTitle}>{isLogin ? "Welcome back" : "Create account"}</Text>
            <Text style={styles.authSubtitle}>
              {isLogin ? "Sign in to keep studying." : "Start building decks in seconds."}
            </Text>
          </View>

          <View style={styles.socialButtons}>
            {/* Node children keep this on the Pressable path: the native button
                can only draw SF Symbols, and there is no Google one. */}
            {/* Node children keep both on the same path: iOS has no Google symbol. */}
            <Button
              variant="secondary"
              size="lg"
              pill
              accessibilityLabel={googleLabel}
              leadingIcon="google"
              onPress={() => void socialSignIn("google")}
              disabled={busy || socialBusy !== null}
              loading={socialBusy === "google"}
              fullWidth
            >
              <>{googleLabel}</>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              pill
              accessibilityLabel={appleLabel}
              leadingIcon="apple"
              onPress={() => void socialSignIn("apple")}
              disabled={busy || socialBusy !== null}
              loading={socialBusy === "apple"}
              fullWidth
            >
              <>{appleLabel}</>
            </Button>
            <View style={styles.authDivider}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerText}>or</Text>
              <View style={styles.authDividerLine} />
            </View>
          </View>

          <View style={styles.authFields}>
            {!isLogin ? (
              <View>
                <Text style={styles.fieldLabel}>Name</Text>
                <Field
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  autoCapitalize="words"
                  autoComplete="name"
                />
              </View>
            ) : null}

            <View>
              <Text style={styles.fieldLabel}>Email</Text>
              <Field
                accessibilityLabel="Email"
                testID="auth-email"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
                value={email}
                onChangeText={setEmail}
                placeholder="you@school.edu"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.fieldLabel}>Password</Text>
                {isLogin ? (
                  <Pressable
                    onPress={() => void forgotPassword()}
                    hitSlop={6}
                    disabled={busy}
                  >
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </Pressable>
                ) : null}
              </View>
              <Field
                accessibilityLabel="Password"
                testID="auth-password"
                ref={passwordInput}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                value={password}
                onChangeText={setPassword}
                placeholder={isLogin ? "Enter your password" : `At least ${MIN_PASSWORD_LENGTH} characters`}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoComplete={isLogin ? "current-password" : "new-password"}
                trailing={
                  <Pressable accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"} onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                    <Icon name={showPw ? "eyeOff" : "eye"} size={18} color={colors.fgQuaternary} />
                  </Pressable>
                }
              />
            </View>

            <Button
              variant="primary"
              size="lg"
              label={busy ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Sign in" : "Create account"}
              onPress={() => void submit()}
              disabled={busy || !email.trim() || !password}
              loading={busy}
              fullWidth
              style={{ marginTop: 6 }}
            />

            <Button
              variant="tertiary"
              size="md"
              label="Send magic link"
              onPress={() => void sendMagicLink()}
              disabled={busy || !email.trim()}
              fullWidth
            />
          </View>

          <View style={styles.switchModeRow}>
            <Text style={styles.switchModeText}>
              {isLogin ? "Don't have an account?" : "Already have an account?"}
            </Text>
            <Pressable onPress={() => onChangeMode(isLogin ? "signup" : "login")} hitSlop={6}>
              <Text style={styles.switchModeLink}>{isLogin ? "Create one" : "Sign in"}</Text>
            </Pressable>
          </View>
          <LegalLinks />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    splashRoot: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
      paddingHorizontal: 24,
    },
    splashHero: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
    },
    splashTitle: {
      ...serifFont(),
      fontSize: 42,
      lineHeight: 48,
      color: colors.fgPrimary,
      letterSpacing: -0.6,
      textAlign: "center",
    },
    splashCopy: {
      fontSize: 16,
      lineHeight: 24,
      color: colors.fgTertiary,
      textAlign: "center",
      maxWidth: 300,
    },
    splashActions: {
      gap: 10,
      paddingBottom: 24,
    },
    authRoot: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
    },
    authScroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 24,
    },
    backBtn: { alignSelf: "flex-start" },
    authBrand: {
      alignItems: "center",
      paddingTop: 8,
    },
    authHeader: {
      alignItems: "center",
      paddingTop: 16,
      paddingBottom: 24,
      gap: 6,
    },
    socialButtons: {
      gap: 10,
      paddingBottom: 16,
    },
    authDivider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 6,
    },
    authDividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.line,
    },
    authDividerText: {
      color: colors.fgTertiary,
      fontSize: 13,
      lineHeight: 18,
    },
    authTitle: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.3,
      textAlign: "center",
    },
    authSubtitle: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    authFields: {
      gap: 12,
    },
    fieldLabel: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgPrimary,
      marginBottom: 6,
    },
    passwordLabelRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    switchModeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      paddingTop: 20,
      paddingBottom: 8,
    },
    switchModeText: {
      fontSize: 14,
      color: colors.fgTertiary,
    },
    switchModeLink: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.fgBrand,
    },
    forgotLink: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgBrand,
    },
  });
}
