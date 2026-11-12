import {
  AUTH_CONSENT_TEXT,
  EMAIL_CODE_MAX_LENGTH,
  EMAIL_CODE_MIN_LENGTH,
  EMAIL_CODE_RESEND_SECONDS,
  isCompleteEmailCode,
  normalizeEmailCode,
} from "@deephaus/shared";
import { Redirect } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { CaptchaPrefetch } from "@/components/auth/captcha-prefetch";
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
  const { signInWithPassword, sendEmailCode, verifyEmailCode, signInWithProvider, resetPassword } =
    useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [usePassword, setUsePassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const passwordInput = useRef<TextInput>(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<"google" | "apple" | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const isLogin = mode === "login";
  const googleLabel = socialBusy === "google" ? "Connecting…" : "Continue with Google";
  const appleLabel = socialBusy === "apple" ? "Connecting…" : "Continue with Apple";

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function continueWithEmail() {
    if (busy || socialBusy || !email.trim()) return;
    if (usePassword && !password) return;
    setBusy(true);
    try {
      if (usePassword) {
        const error = await signInWithPassword(email.trim(), password);
        if (error) Alert.alert("Sign in failed", error);
        else posthog.capture("user_signed_in", { method: "password" });
        return;
      }
      const error = await sendEmailCode(email.trim());
      if (error) {
        Alert.alert("Couldn't send a code", error);
        return;
      }
      setCode("");
      setResendIn(EMAIL_CODE_RESEND_SECONDS);
      setStep("code");
    } catch {
      Alert.alert("Something went wrong", "Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value = code) {
    if (busy || !isCompleteEmailCode(value)) return;
    setBusy(true);
    try {
      const error = await verifyEmailCode(email.trim(), value);
      if (error) Alert.alert("Sign in failed", error);
      else posthog.capture("user_signed_in", { method: "email_code" });
    } catch {
      Alert.alert("Sign in failed", "Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy || resendIn > 0) return;
    setBusy(true);
    try {
      const error = await sendEmailCode(email.trim());
      if (error) Alert.alert("Couldn't send a code", error);
      else setResendIn(EMAIL_CODE_RESEND_SECONDS);
    } finally {
      setBusy(false);
    }
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

  const consent = (
    <Text style={styles.consentText}>{AUTH_CONSENT_TEXT}</Text>
  );

  if (step === "code") {
    return (
      <SafeAreaView style={styles.authRoot}>
        <CaptchaPrefetch />
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
              accessibilityLabel="Use a different email"
              onPress={() => setStep("email")}
              style={styles.backBtn}
            />
            <View style={styles.authHeader}>
              <Text style={styles.authTitle}>Check your email</Text>
              <Text style={styles.authSubtitle}>Enter the code we sent to {email.trim()}.</Text>
            </View>
            <View style={styles.authFields}>
              <Field
                accessibilityLabel="Code"
                testID="auth-code"
                value={code}
                onChangeText={(text) => {
                  const next = normalizeEmailCode(text);
                  setCode(next);
                  // Pasted or autofilled from Mail: go straight on.
                  if (next.length >= EMAIL_CODE_MIN_LENGTH && next.length - code.length > 1) void submitCode(next);
                }}
                placeholder="Code from the email"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={EMAIL_CODE_MAX_LENGTH}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => void submitCode()}
                inputStyle={code ? styles.codeInput : undefined}
              />
              <Button
                variant="primary"
                size="lg"
                label={busy ? "Checking…" : "Continue"}
                onPress={() => void submitCode()}
                disabled={busy || !isCompleteEmailCode(code)}
                loading={busy}
                fullWidth
              />
              <Button
                variant="tertiary"
                size="md"
                label={resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
                onPress={() => void resendCode()}
                disabled={busy || resendIn > 0}
                fullWidth
              />
              <Text style={styles.hintText}>
                The email also has a link. Tap it on this phone to sign in instead.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.authRoot}>
      <CaptchaPrefetch />
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
            {/* Node children keep both on the Pressable path: the native button
                can only draw SF Symbols, and there is no Google one. */}
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
            <View style={styles.authDivider}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerText}>or</Text>
              <View style={styles.authDividerLine} />
            </View>
          </View>
          <View style={styles.authFields}>
            <View>
              <Text style={styles.fieldLabel}>Email</Text>
              <Field
                accessibilityLabel="Email"
                testID="auth-email"
                returnKeyType={usePassword ? "next" : "go"}
                submitBehavior="submit"
                onSubmitEditing={() =>
                  usePassword ? passwordInput.current?.focus() : void continueWithEmail()
                }
                value={email}
                onChangeText={setEmail}
                placeholder="you@school.edu"
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType={usePassword ? "username" : "emailAddress"}
                autoComplete="email"
              />
            </View>
            {usePassword ? (
              <View>
                <View style={styles.passwordLabelRow}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <Pressable
                    onPress={() => void forgotPassword()}
                    hitSlop={6}
                    disabled={busy}
                  >
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </Pressable>
                </View>
                <Field
                  accessibilityLabel="Password"
                  testID="auth-password"
                  ref={passwordInput}
                  returnKeyType="go"
                  onSubmitEditing={() => void continueWithEmail()}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  trailing={
                    <Pressable accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"} onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                      <Icon name={showPw ? "eyeOff" : "eye"} size={18} color={colors.fgQuaternary} />
                    </Pressable>
                  }
                />
              </View>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              label={busy ? "Please wait…" : usePassword ? "Sign in" : "Continue with email"}
              onPress={() => void continueWithEmail()}
              disabled={busy || !email.trim() || (usePassword && !password)}
              loading={busy}
              fullWidth
              style={{ marginTop: 6 }}
            />
            {isLogin ? (
              <Button
                variant="tertiary"
                size="md"
                label={usePassword ? "Email me a code instead" : "Use a password instead"}
                onPress={() => setUsePassword((v) => !v)}
                disabled={busy}
                fullWidth
              />
            ) : null}
            {consent}
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
    consentText: {
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
      paddingTop: 4,
    },
    hintText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    codeInput: {
      fontSize: 22,
      letterSpacing: 6,
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },
    forgotLink: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgBrand,
    },
  });
}
