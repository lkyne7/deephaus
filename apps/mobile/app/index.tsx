import { Link, router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "@/lib/config";

export default function HomeScreen() {
  const [email, setEmail] = useState("");

  async function signIn() {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) Alert.alert("Sign in failed", error.message);
    else Alert.alert("Check your email", "We sent you a magic link.");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DeepHaus</Text>
      <Text style={styles.subtitle}>
        Turn notes and PDFs into Anki flashcards on the go.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#8b9cb3"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Pressable style={styles.button} onPress={() => void signIn()}>
        <Text style={styles.buttonText}>Send magic link</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => router.push("/projects")}>
        <Text style={styles.secondaryText}>Go to projects</Text>
      </Pressable>
      <Link href="/projects" style={styles.link}>
        Skip to projects →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 12 },
  title: { fontSize: 36, fontWeight: "700", color: "#e8edf4" },
  subtitle: { color: "#8b9cb3", marginBottom: 12 },
  input: {
    backgroundColor: "#1a2332",
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    color: "#e8edf4",
  },
  button: {
    backgroundColor: "#5b9fd4",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  buttonText: { color: "#0f1419", fontWeight: "700" },
  secondaryButton: {
    borderColor: "#2d3a4d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  secondaryText: { color: "#e8edf4" },
  link: { color: "#5b9fd4", marginTop: 8 },
});
