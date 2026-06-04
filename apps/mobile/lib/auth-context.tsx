import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
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
import { supabase } from "@/lib/config";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<string | null>;
  signInWithMagicLink: (email: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function handleAuthCallback(url: string) {
  const parsed = Linking.parse(url);
  const params = parsed.queryParams ?? {};
  const code = typeof params.code === "string" ? params.code : null;
  const accessToken = typeof params.access_token === "string" ? params.access_token : null;
  const refreshToken = typeof params.refresh_token === "string" ? params.refresh_token : null;

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
    return;
  }

  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      void handleAuthCallback(url).then(() => router.replace("/(tabs)/dashboard"));
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
    await supabase.auth.signOut();
    router.replace("/");
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signInWithPassword,
      signInWithMagicLink,
      signUp,
      signOut,
    }),
    [session, loading, signInWithPassword, signInWithMagicLink, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
