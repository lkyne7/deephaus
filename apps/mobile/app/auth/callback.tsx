import { Text, View } from "react-native";
// AuthProvider validates and consumes the callback, including cold starts.
export default function Callback() {
  return (
    <View style={{ padding: 32 }}>
      <Text accessibilityRole="alert">Verifying your sign-in link…</Text>
    </View>
  );
}
