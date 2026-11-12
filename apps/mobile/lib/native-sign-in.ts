import type { User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "@/lib/config";

/**
 * Apple and Google sign-in through the system sheets: one Face ID tap or one
 * account pick, no browser. Supabase verifies the ID token (and doesn't ask
 * for a CAPTCHA token on this path).
 */
export type NativeSignInResult =
  | { status: "signed-in"; user: User | null }
  | { status: "canceled" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export async function nativeAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Native Google needs the iOS OAuth client ID baked into the build. */
export const nativeGoogleAvailable = Platform.OS === "ios" && GOOGLE_IOS_CLIENT_ID.length > 0;

function appleFullName(name: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  if (!name) return null;
  const joined = [name.givenName, name.familyName].filter(Boolean).join(" ").trim();
  return joined || null;
}

export async function signInWithAppleNative(): Promise<NativeSignInResult> {
  if (!(await nativeAppleAvailable())) return { status: "unavailable" };
  // Apple signs a hash of the nonce; Supabase checks it against the raw value.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_REQUEST_CANCELED") return { status: "canceled" };
    return { status: "error", message: error instanceof Error ? error.message : "Apple sign-in failed." };
  }
  if (!credential.identityToken) return { status: "error", message: "Apple didn't return a sign-in token." };

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) return { status: "error", message: error.message };

  // Apple shares the name only on the very first sign-in; keep it.
  const name = appleFullName(credential.fullName);
  let user = data.user;
  if (name && !user?.user_metadata?.full_name) {
    const updated = await supabase.auth.updateUser({ data: { full_name: name, name } });
    if (!updated.error) user = updated.data.user;
  }
  return { status: "signed-in", user };
}

export async function signInWithGoogleNative(): Promise<NativeSignInResult> {
  if (!nativeGoogleAvailable) return { status: "unavailable" };
  // Loaded only when configured: the module needs the client's URL scheme in Info.plist.
  const { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } =
    require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
  GoogleSignin.configure({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    // The ID token is issued for the web client Supabase already trusts.
    ...(GOOGLE_WEB_CLIENT_ID ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {}),
  });
  try {
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return { status: "canceled" };
    const idToken = response.data.idToken;
    if (!idToken) return { status: "error", message: "Google didn't return a sign-in token." };
    const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
    if (error) return { status: "error", message: error.message };
    return { status: "signed-in", user: data.user };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) return { status: "canceled" };
    return { status: "error", message: error instanceof Error ? error.message : "Google sign-in failed." };
  }
}

/** Ends Google's own session too, so the next sign-in offers the account picker. */
export async function signOutNativeProviders(): Promise<void> {
  if (!nativeGoogleAvailable) return;
  try {
    const { GoogleSignin } =
      require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google.
  }
}
