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
import { loadStoredSession } from "@/lib/auth-session";
import { configureBilling, logOutBilling } from "@/lib/billing";
import { supabase } from "@/lib/config";
import { posthog } from "@/lib/posthog";
import {
  teardownPowerSync,
  waitForPowerSyncUploads,
} from "@/lib/powersync";

WebBrowser.maybeCompleteAuthSession();
const processedAuthCodes = new Set<string>();

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  signInWithMagicLink: (email: string) => Promise<string | null>;
  signInWithProvider: (provider: "google" | "apple") => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function handleAuthCallback(url: string): Promise<boolean> {
  const parsed = Linking.parse(url);
  const params = parsed.queryParams ?? {};
  const code = typeof params.code === "string" ? params.code : null;
  const accessToken = typeof params.access_token === "string" ? params.access_token : null;
  const refreshToken = typeof params.refresh_token === "string" ? params.refresh_token : null;

  if (code) {
    if (processedAuthCodes.has(code)) return true;
    processedAuthCodes.add(code);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      processedAuthCodes.delete(code);
      throw error;
    }
    return true;
  }

  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return true;
  }
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    void loadStoredSession()
      .then((nextSession) => {
        if (mounted) {
          setSession(nextSession);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setLoading(false);
        }
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      void handleAuthCallback(url).then((handled) => {
        if (handled) router.replace("/(tabs)/dashboard");
      });
    });

    void Linking.getInitialURL().then((url) => {
      if (url) void handleAuthCallback(url);
    });

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

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL("auth/callback");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    return error?.message ?? null;
  }, []);

  const signInWithProvider = useCallback(async (provider: "google" | "apple") => {
    const redirectTo = Linking.createURL("auth/callback");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) return error.message;
    if (!data.url) return "The authentication provider did not return a sign-in URL.";

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "cancel" || result.type === "dismiss") return "Sign in was canceled.";
    if (result.type !== "success" || !result.url) return "Sign in could not be completed.";

    try {
      await handleAuthCallback(result.url);
      router.replace("/(tabs)/dashboard");
      return null;
    } catch (callbackError) {
      return callbackError instanceof Error ? callbackError.message : "Sign in could not be completed.";
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const trimmed = displayName.trim();
    if (!trimmed) return "Name is required.";
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: trimmed, name: trimmed } },
    });
    return error?.message ?? null;
  }, []);

  const signOut = useCallback(async () => {
    const completeSignOut = async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert("Sign out failed", error.message);
        return;
      }
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
      signInWithPassword,
      signInWithMagicLink,
      signInWithProvider,
      signUp,
      signOut,
    }),
    [
      session,
      loading,
      signInWithPassword,
      signInWithMagicLink,
      signInWithProvider,
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
