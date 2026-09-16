import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { router, usePathname } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

export function ReauthenticationNotice() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (
    !session ||
    pathname.startsWith("/auth/") ||
    (session.access_token && (session.expires_at ?? 0) * 1000 > now)
  )
    return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign in again to sync saved work"
      onPress={() => router.push("/auth/reauthenticate")}
      style={{ padding: 12, backgroundColor: colors.bgSurface }}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.fgPrimary }}
      >
        Your library stays on this device. Sign in again to sync saved work.
      </Text>
    </Pressable>
  );
}
