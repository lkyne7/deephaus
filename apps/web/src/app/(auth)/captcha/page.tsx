import type { Metadata } from "next";
import { CaptchaHandoff } from "@/components/auth/captcha-handoff";
import { CaptchaEmbed } from "@/components/auth/captcha-embed";

export const metadata: Metadata = { title: "Security check · DeepHaus", robots: { index: false } };

/**
 * The phone app loads this page in a hidden in-app web view (`?embed=1`) to
 * get a Turnstile token for Supabase Auth while the person types. If Cloudflare
 * wants a visible check, the app opens it in a browser sheet instead and reads
 * the token from the redirect to its own scheme (`?return=`).
 */
export default async function CaptchaPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string; embed?: string }>;
}) {
  const { return: returnTo, embed } = await searchParams;
  if (embed === "1") return <CaptchaEmbed />;
  return <CaptchaHandoff returnTo={returnTo ?? ""} />;
}
