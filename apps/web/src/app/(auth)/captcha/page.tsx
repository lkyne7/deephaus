import type { Metadata } from "next";
import { CaptchaHandoff } from "@/components/auth/captcha-handoff";

export const metadata: Metadata = { title: "Security check · DeepHaus", robots: { index: false } };

/**
 * The phone app opens this page in a browser sheet to get a Turnstile token
 * for Supabase Auth, then reads the token from the redirect to its own scheme.
 */
export default async function CaptchaPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>;
}) {
  const { return: returnTo } = await searchParams;
  return <CaptchaHandoff returnTo={returnTo ?? ""} />;
}
