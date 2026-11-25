import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { hostIsIndexable, SITE_URL } from "@/lib/site/url";

// Signed-in app screens, auth flows and API routes have nothing for a search
// engine; keeping crawlers out also keeps them off rate-limited endpoints.
const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/dashboard",
  "/decks",
  "/cards",
  "/create",
  "/review",
  "/exams",
  "/insights",
  "/profile",
  "/settings",
  "/community",
  "/onboarding",
  "/onboarding-preview",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/oauth",
  "/captcha",
  "/launch-benchmark",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!hostIsIndexable((await headers()).get("host"))) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
