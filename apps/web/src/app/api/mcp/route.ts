import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createBearerClient } from "@deephaus/api-client";
import { registerDeepHausPrompts, registerDeepHausTools, SERVER_INSTRUCTIONS } from "@deephaus/mcp-core";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiToken } from "@/lib/auth/api-token";
import { appOrigin } from "@/lib/oauth/urls";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerDeepHausTools(server, (extra) => {
      const authInfo = extra.authInfo;
      if (!authInfo) {
        throw new Error("Unauthorized: missing bearer token");
      }
      const origin = (authInfo.extra as { origin?: string } | undefined)?.origin;
      if (!origin) {
        throw new Error("Could not resolve API origin for this request");
      }
      return createBearerClient(origin, async () => authInfo.token);
    });
    registerDeepHausPrompts(server);
  },
  {
    serverInfo: { name: "deephaus", version: "0.2.0" },
    instructions: SERVER_INSTRUCTIONS,
    capabilities: {},
  },
  {
    basePath: "/api",
    maxDuration: 60,
    disableSse: true,
  },
);

const verifyToken = async (req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  const verified = await verifyApiToken(bearerToken);
  if (!verified) return undefined;
  return {
    token: bearerToken,
    clientId: verified.tokenId,
    scopes: verified.scopes,
    extra: {
      userId: verified.userId,
      // Tools call back into this deployment's own /api/* routes.
      origin: appOrigin(req),
    },
  };
};

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
