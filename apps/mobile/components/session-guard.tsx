import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

/**
 * For signed-in screens outside the (app) group, whose layout otherwise holds
 * them back until the session is known and sends signed-out users away.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.bgCanvas }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session) return <Redirect href="/" />;

  return children;
}
