import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Mode = "splash" | "login" | "signup";

export default function AuthGate() {
  const { loading, session } = useAuth();
  const [mode, setMode] = useState<Mode>("splash");

  if (!loading && session) {
    return <Redirect href="/(tabs)/dashboard" />;
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
        <FeaturedIcon icon="sparkles" variant="brand" size="2xl" style={styles.brandMark} />
        <Text style={styles.splashTitle}>Learn more,{"\n"}study less.</Text>
        <Text style={styles.splashCopy}>
          AI-powered flashcards that adapt to how you remember.
        </Text>
      </View>

      <View style={styles.splashActions}>
        <Button
          variant="primary"
          size="xl"
          label="Get Started"
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
  const { signInWithPassword, signInWithMagicLink, signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const isLogin = mode === "login";

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    const error = isLogin
      ? await signInWithPassword(email.trim(), password)
      : await signUp(email.trim(), password, name.trim());
    setBusy(false);
    if (error) {
      Alert.alert(isLogin ? "Sign in failed" : "Sign up failed", error);
    } else if (!isLogin) {
      Alert.alert("Account created", "You can sign in now.");
      onChangeMode("login");
    }
  }

  async function sendMagicLink() {
    if (!email.trim()) return;
    setBusy(true);
    const error = await signInWithMagicLink(email.trim());
    setBusy(false);
    if (error) Alert.alert("Magic link failed", error);
    else Alert.alert("Check your email", "Tap the link to open DeepHaus.");
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
          <Pressable
            onPress={() => onChangeMode("splash")}
            style={styles.backBtn}
            hitSlop={8}
          >
            <Icon name="arrowLeft" size={24} color={colors.fgPrimary} />
          </Pressable>

          <View style={styles.authBrand}>
            <FeaturedIcon icon="sparkles" variant="brand" size="xl" />
          </View>

          <View style={styles.authHeader}>
            <Text style={styles.authTitle}>{isLogin ? "Welcome back" : "Create account"}</Text>
            <Text style={styles.authSubtitle}>
              {isLogin ? "Log in to keep your streak going." : "Start building decks in seconds."}
            </Text>
          </View>

          <View style={styles.authFields}>
            {!isLogin ? (
              <View>
                <Text style={styles.fieldLabel}>Name</Text>
                <Field
                  leadingIcon="user"
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
                leadingIcon="mail"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View>
              <Text style={styles.fieldLabel}>Password</Text>
              <Field
                leadingIcon="lock"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••••"
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoComplete={isLogin ? "current-password" : "new-password"}
                trailing={
                  <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                    <Icon name={showPw ? "eyeOff" : "eye"} size={18} color={colors.fgQuaternary} />
                  </Pressable>
                }
              />
            </View>

            <Button
              variant="primary"
              size="xl"
              label={busy ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Log In" : "Create account"}
              onPress={() => void submit()}
              disabled={busy || !email.trim() || !password}
              loading={busy}
              fullWidth
              style={{ marginTop: 6 }}
            />

            <Button
              variant="secondary"
              size="lg"
              label="Send magic link"
              leadingIcon="mail"
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
              <Text style={styles.switchModeLink}>{isLogin ? "Sign up" : "Log in"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    splashRoot: {
      flex: 1,
      backgroundColor: colors.bgSurface,
      paddingHorizontal: 24,
    },
    splashHero: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 28,
    },
    brandMark: {
      width: 88,
      height: 88,
      borderRadius: radius.xl3,
    },
    splashTitle: {
      fontSize: 36,
      lineHeight: 44,
      fontWeight: "600",
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
      backgroundColor: colors.bgSurface,
    },
    authScroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 32,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    authBrand: {
      alignItems: "center",
      paddingTop: 24,
    },
    authHeader: {
      alignItems: "center",
      paddingTop: 8,
      paddingBottom: 24,
      gap: 4,
    },
    authTitle: {
      fontSize: 26,
      lineHeight: 32,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.4,
    },
    authSubtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
    },
    authFields: {
      gap: 12,
    },
    fieldLabel: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    switchModeRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      paddingTop: 28,
    },
    switchModeText: {
      fontSize: 14,
      color: colors.fgTertiary,
    },
    switchModeLink: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.brand600,
    },
  });
}
