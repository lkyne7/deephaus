import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/oauth/urls", () => ({ appOrigin: () => "https://app.test" }));

import { GET, OPTIONS } from "@/app/.well-known/oauth-protected-resource/[[...resource]]/route";
import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/route";

describe("MCP OAuth discovery", () => {
  it.each(["", "/api/mcp"])("discovers the same resource through %s", async (suffix) => {
    const response = GET(new Request(`https://internal.test/.well-known/oauth-protected-resource${suffix}`));
    const resource = await response.json();
    const authorization = await authorizationMetadata(new Request("https://internal.test")).json();
    expect(resource.resource).toBe("https://app.test/api/mcp");
    expect(resource.authorization_servers).toEqual([authorization.issuer]);
    expect(resource.scopes_supported).toEqual(authorization.scopes_supported);
    expect(resource.bearer_methods_supported).toEqual(["header"]);
    expect(authorization.code_challenge_methods_supported).toEqual(["S256"]);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("allows metadata preflight without a bearer token", async () => {
    const response = await OPTIONS();
    expect(response.ok).toBe(true);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
