import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { service, plan, row } = vi.hoisted(() => ({
  service: vi.fn(), plan: vi.fn(), row: { data: null as unknown, error: null },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: service }));
vi.mock("@/lib/billing/access", () => ({ getEffectivePlan: plan }));
vi.mock("@/lib/oauth/request-resource", () => ({ requestMcpResource: async () => "https://app.test/api/mcp" }));

import { isAllowedRedirectUri, redirectUriMatches, resolveClient } from "../clients";
import { validateAuthorizeRequest } from "../authorize";
import { verifyPkceS256 } from "../crypto";
import { verifyApiToken } from "@/lib/auth/api-token";

const resource = "https://app.test/api/mcp";
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const clientId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  plan.mockResolvedValue("pro");
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "update"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => row);
  query.then = vi.fn((resolve: (value: unknown) => void) => resolve({ error: null }));
  service.mockReturnValue({ from: vi.fn(() => query) });
  row.data = { client_id: clientId, client_name: "Test client", redirect_uris: ["https://client.test/callback"] };
});

describe("OAuth client validation", () => {
  it.each(["javascript:alert(1)", "data:text/html,hi", "file:///tmp/x", "ftp://host/path", "https://user:pass@host/callback", "https://host/callback#fragment", "http://public.test/callback"])("rejects unsafe redirect %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
  it.each(["https://client.test/callback", "http://127.0.0.1:4444/callback", "cursor://callback", "com.example.app:/callback"])("accepts supported redirect %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });
  it("allows only the loopback port to vary", () => {
    expect(redirectUriMatches("http://127.0.0.1:1111/cb?a=1", "http://127.0.0.1:2222/cb?a=1")).toBe(true);
    for (const uri of ["http://127.0.0.1:2222/cb?a=2", "http://127.0.0.1:2222/else?a=1", "http://localhost:2222/cb?a=1", "http://127.0.0.1:2222/cb?a=1#x"]) {
      expect(redirectUriMatches("http://127.0.0.1:1111/cb?a=1", uri)).toBe(false);
    }
  });
  it("never fetches URL client IDs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await resolveClient("https://127.0.0.1/private")).toBeNull();
    expect(await resolveClient("https://attacker.test/client.json")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("authorization requests", () => {
  const params = { client_id: clientId, redirect_uri: "https://client.test/callback", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", resource };
  it("binds consent to the canonical audience and requested scopes", async () => {
    const result = await validateAuthorizeRequest({ ...params, scope: "study" }, resource);
    expect(result).toMatchObject({ status: "valid", request: { resource, scopes: ["study"] } });
  });
  it("binds legacy clients that omit resource to the single known resource", async () => {
    expect(await validateAuthorizeRequest({ ...params, resource: undefined }, resource)).toMatchObject({ status: "valid", request: { resource } });
  });
  it.each([
    [{ resource: "https://other.test/api/mcp" }, "invalid_target"],
    [{ scope: "admin" }, "invalid_scope"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge_method: undefined }, "invalid_request"],
    [{ code_challenge: "short" }, "invalid_request"],
  ])("rejects invalid consent parameters %j", async (changes, error) => {
    expect(await validateAuthorizeRequest({ ...params, ...changes }, resource)).toMatchObject({ status: "redirect_error", error });
  });
  it("does not redirect to an unregistered URI", async () => {
    expect(await validateAuthorizeRequest({ ...params, redirect_uri: "https://attacker.test" }, resource)).toMatchObject({ status: "fatal" });
  });
  it("checks the PKCE verifier alphabet and digest", () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("b".repeat(43), challenge)).toBe(false);
    expect(verifyPkceS256("!".repeat(43), createHash("sha256").update("!".repeat(43)).digest("base64url"))).toBe(false);
  });
});

describe("opaque access-token audience checks", () => {
  const token = `dh_${"a".repeat(43)}`;
  it.each([null, "https://other.test/api/mcp"])("rejects unbound/wrong audience %s", async (audience) => {
    row.data = { id: "token", user_id: "user", kind: "oauth", resource: audience, scopes: ["study"] };
    expect(await verifyApiToken(token, resource)).toBeNull();
    expect(plan).not.toHaveBeenCalled();
  });
  it("accepts the intended audience and preserves the Pro gate", async () => {
    row.data = { id: "token", user_id: "user", kind: "oauth", resource, scopes: ["study"] };
    expect(await verifyApiToken(token, resource)).toMatchObject({ userId: "user", scopes: ["study"] });
    plan.mockResolvedValue("free");
    expect(await verifyApiToken(token, resource)).toBeNull();
  });
  it("preserves personal token compatibility", async () => {
    row.data = { id: "token", user_id: "user", kind: "pat", resource: null, scopes: ["study"] };
    expect(await verifyApiToken(token)).toMatchObject({ userId: "user" });
  });
  it("rejects expired OAuth tokens", async () => {
    row.data = { id: "token", user_id: "user", kind: "oauth", resource, expires_at: "2000-01-01", scopes: ["study"] };
    expect(await verifyApiToken(token, resource)).toBeNull();
  });
});
