/**
 * OAuth redirect URI registered with Notion. Prefer NOTION_REDIRECT_URI when set
 * (production Vercel env), else NEXT_PUBLIC_APP_URL, else the live request origin
 * (local dev at localhost:3000).
 */
export function notionRedirectUri(origin: string): string {
  const explicit = process.env.NOTION_REDIRECT_URI?.trim();
  if (explicit) return explicit;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/api/notion/callback`;

  return `${origin.replace(/\/$/, "")}/api/notion/callback`;
}
