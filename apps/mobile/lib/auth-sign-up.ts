import * as Linking from "expo-linking";
import { supabase } from "@/lib/config";

export type SignUpResult = { error?: string; needsConfirmation?: boolean };

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<SignUpResult> {
  const name = displayName.trim();
  if (!name) return { error: "Name is required." };
  if (name.length > 80) return { error: "Name must be 80 characters or fewer." };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: Linking.createURL("auth/callback"),
      data: { full_name: name, name },
    },
  });
  return error ? { error: error.message } : { needsConfirmation: !data.session };
}
