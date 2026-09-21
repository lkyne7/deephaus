import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Alert } from "react-native";
import { parseAuthCallback } from "@/lib/auth-callback";
import { signUpWithEmail, type SignUpResult } from "@/lib/auth-sign-up";
import {
  loadStoredSession,
  prepareExplicitSignOut,
  completeExplicitSignOut,
  cancelExplicitSignOut,
} from "@/lib/auth-session";
import { configureBilling, logOutBilling } from "@/lib/billing";
import { AUTH_SCHEME, supabase } from "@/lib/config";
import { posthog } from "@/lib/posthog";
import { teardownPowerSync, waitForPowerSyncUploads } from "@/lib/powersync";

WebBrowser.maybeCompleteAuthSession();
const processedAuthCodes = new Map<string, Promise<void>>();

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  recovering: boolean;
  finishRecovery: () => void;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<string | null>;
  signInWithMagicLink: (email: string) => Promise<string | null>;
  signInWithProvider: (provider: "google" | "apple") => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function handleAuthCallback(
  url: string,
): Promise<"login" | "recovery" | null> {
  const parsed = parseAuthCallback(url, AUTH_SCHEME);
  if (!parsed) return null;
  const { code, accessToken, refreshToken, recovery } = parsed;
  if (code) {
    let exchange = processedAuthCodes.get(code);
    if (!exchange) {
      exchange = supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            processedAuthCodes.delete(code);
            throw error;
          }
        });
      processedAuthCodes.set(code, exchange);
      if (processedAuthCodes.size > 20)
        processedAuthCodes.delete(processedAuthCodes.keys().next().value!);
    }
    await exchange;
  } else if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  } else {
    throw new Error("This sign-in link is incomplete. Request a new link.");
  }
  return recovery ? "recovery" : "login";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const finishRecovery = useCallback(() => setRecovering(false), []);

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;

    void loadStoredSession()
      .then((nextSession) => {
        if (mounted && authRevision === 0) {
          setSession(nextSession);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted && authRevision === 0) {
          setSession(null);
          setLoading(false);
        }
      });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        const revision = ++authRevision;
        if (event === "PASSWORD_RECOVERY") setRecovering(true);
        if (event === "SIGNED_OUT") setRecovering(false);
        if (nextSession) {
          setSession(nextSession);
          setLoading(false);
        } else {
          // Run outside auth-js's callback lock. Automatic expiry retains local
          // access; explicit sign-out returns null from loadStoredSession.
          void Promise.resolve()
            .then(loadStoredSession)
            .then((local) => {
              if (mounted && authRevision === revision) {
                setSession(local);
                setLoading(false);
              }
            })
            .catch(() => {
              if (mounted && authRevision === revision) setLoading(false);
            });
        }
      },
    );

    const handleLink = async (url: string) => {
      try {
        const outcome = await handleAuthCallback(url);
        if (!mounted || !outcome) return;
        setRecovering(outcome === "recovery");
        router.replace(
          outcome === "recovery" ? "/auth/reset-password" : "/(tabs)/dashboard",
        );
      } catch {
        if (mounted) {
          router.replace("/");
          Alert.alert(
            "Sign-in link failed",
            "This link could not be verified. Please request a new link and try again.",
          );
        }
      }
    };
    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      void handleLink(url);
    });
    void Linking.getInitialURL()
      .then((url) => {
        if (url) void handleLink(url);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      linkingSub.remove();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (session?.user.id) {
      void configureBilling(session.user.id);
      const displayName =
        (session.user.user_metadata?.full_name as string | undefined) ??
        (session.user.user_metadata?.name as string | undefined);
      posthog.identify(session.user.id, {
        ...(session.user.email ? { email: session.user.email } : {}),
        ...(displayName ? { name: displayName } : {}),
      });
    } else {
      void logOutBilling().catch(() => undefined);
    }
  }, [loading, session?.user.id]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return error?.message ?? null;
    },
    [],
  );

  const signInWithMagicLink = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL("auth/callback");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    return error?.message ?? null;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL("auth/callback", {
      queryParams: { recovery: "1" },
    });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return error?.message ?? null;
  }, []);

  const signInWithProvider = useCallback(
    async (provider: "google" | "apple") => {
      const redirectTo = Linking.createURL("auth/callback");
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) return error.message;
      if (!data.url)
        return "The authentication provider did not return a sign-in URL.";

      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );
      if (result.type === "cancel" || result.type === "dismiss")
        return "Sign in was canceled.";
      if (result.type !== "success" || !result.url)
        return "Sign in could not be completed.";

      try {
        const outcome = await handleAuthCallback(result.url);
        if (!outcome) return "Sign in could not be completed.";
        router.replace("/(tabs)/dashboard");
        return null;
      } catch (callbackError) {
        return callbackError instanceof Error
          ? callbackError.message
          : "Sign in could not be completed.";
      }
    },
    [],
  );

  const signUp = useCallback(signUpWithEmail, []);

  const signOut = useCallback(async () => {
    const completeSignOut = async () => {
      await prepareExplicitSignOut();
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch (error) {
        cancelExplicitSignOut();
        Alert.alert("Sign out failed", error instanceof Error ? error.message : "Please try again.");
        return;
      }
      await completeExplicitSignOut();
      await teardownPowerSync();
      await logOutBilling().catch(() => undefined);
      posthog.capture("user_signed_out");
      posthog.reset();
      router.replace("/");
    };

    if (await waitForPowerSyncUploads()) {
      await completeSignOut();
      return;
    }

    Alert.alert(
      "Offline changes haven’t synced",
      "You can stay signed in and try again later, or discard the unsynced changes and sign out.",
      [
        { text: "Stay signed in", style: "cancel" },
        {
          text: "Discard and sign out",
          style: "destructive",
          onPress: () => {
            void completeSignOut();
          },
        },
      ],
    );
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      recovering,
      finishRecovery,
      signInWithPassword,
      signInWithMagicLink,
      signInWithProvider,
      resetPassword,
      signUp,
      signOut,
    }),
    [
      session,
      loading,
      recovering,
      finishRecovery,
      signInWithPassword,
      signInWithMagicLink,
      signInWithProvider,
      resetPassword,
      signUp,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
