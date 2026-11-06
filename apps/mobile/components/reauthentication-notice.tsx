import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { router, usePathname } from "expo-router";
import { Icon } from "@/components/ui/icon";
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
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: colors.bgRail,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{
          flex: 1,
          fontSize: 13,
          lineHeight: 18,
          color: colors.fgSecondary,
        }}
      >
        Your library stays on this device. Sign in again to sync saved work.
      </Text>
      <Icon name="arrowRightSmall" size={16} color={colors.fgTertiary} />
    </Pressable>
  );
}
