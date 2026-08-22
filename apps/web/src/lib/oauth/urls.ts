import { getPublicOrigin } from "mcp-handler";

/**
 * Public origin of this deployment. Used as the OAuth issuer, the MCP
 * resource identifier base, and the callback origin MCP tools hit.
 * NEXT_PUBLIC_APP_URL wins when set; otherwise derived from proxy headers.
 */
export function appOrigin(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return getPublicOrigin(req);
}
