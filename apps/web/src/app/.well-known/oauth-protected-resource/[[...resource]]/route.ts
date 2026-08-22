import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { appOrigin } from "@/lib/oauth/urls";

// Optional catch-all: RFC 9728 allows clients to request either
// /.well-known/oauth-protected-resource or the path-suffixed variant
// (/.well-known/oauth-protected-resource/api/mcp). Serve both.

export function GET(req: Request) {
  const origin = appOrigin(req);
  return protectedResourceHandler({
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp`,
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
