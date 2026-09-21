import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { appOrigin } from "@/lib/oauth/urls";

// Optional catch-all: RFC 9728 allows clients to request either
// /.well-known/oauth-protected-resource or the path-suffixed variant
// (/.well-known/oauth-protected-resource/api/mcp). Serve both.

export function GET(req: Request) {
  const origin = appOrigin(req);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["study", "write"],
      bearer_methods_supported: ["header"],
      resource_name: "DeepHaus",
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
