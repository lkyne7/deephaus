import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(), mint: vi.fn(), rotate: vi.fn(), service: vi.fn(), insert: vi.fn(),
}));
vi.mock("@/lib/auth/rate-limit", () => ({ checkPatRateLimit: () => ({ limited: false }) }));
vi.mock("@/lib/oauth/authorize", () => ({ consumeAuthorizationCode: mocks.consume }));
vi.mock("@/lib/oauth/tokens", () => ({ mintTokenPair: mocks.mint, rotateRefreshToken: mocks.rotate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/oauth/urls", () => ({ appOrigin: () => "https://app.test" }));
vi.mock("@/lib/oauth/crypto", () => ({ verifyPkceS256: (value: string) => value === "valid-verifier" }));
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as token } from "@/app/api/oauth/token/route";

const resource = "https://app.test/api/mcp";
const pair = { accessToken: "access", refreshToken: "refresh", expiresIn: 3600, scopes: ["study"] };
const codeForm = { grant_type: "authorization_code", code: "code", client_id: "client", redirect_uri: "https://client.test/cb", code_verifier: "valid-verifier", resource };
const request = (values: Record<string, string>) => new Request("https://app.test/api/oauth/token", {
  method: "POST", body: new URLSearchParams(values),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consume.mockResolvedValue({ clientId: "client", redirectUri: "https://client.test/cb", resource, scopes: ["study"], userId: "user", expired: false });
  mocks.mint.mockResolvedValue(pair);
  mocks.rotate.mockResolvedValue({ ok: true, pair });
  const query = { select: vi.fn(), single: vi.fn() };
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue({ data: { client_id: "registered", created_at: "2026-09-17" }, error: null });
  mocks.insert.mockReturnValue(query);
  mocks.service.mockReturnValue({ from: () => ({ insert: mocks.insert }) });
});

describe("MCP token endpoint", () => {
  it("issues only the consented scope and resource, with no cache", async () => {
    const response = await token(request(codeForm));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.mint).toHaveBeenCalledWith(expect.objectContaining({ resource, scopes: ["study"] }));
  });
  it.each([
    [{ resource: "https://attacker.test" }, "invalid_target"],
    [{ client_id: "other" }, "invalid_grant"],
    [{ redirect_uri: "https://other.test" }, "invalid_grant"],
    [{ code_verifier: "bad" }, "invalid_grant"],
    [{ client_secret: "unsupported" }, "invalid_client"],
  ])("rejects invalid exchange %j", async (changes, error) => {
    const response = await token(request({ ...codeForm, ...changes }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error });
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("rejects a legacy authorization code without an audience", async () => {
    mocks.consume.mockResolvedValue({ expired: false, resource: null });
    expect((await token(request(codeForm))).status).toBe(400);
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("requires client binding when refreshing", async () => {
    expect((await token(request({ grant_type: "refresh_token", refresh_token: "refresh" }))).status).toBe(400);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });
  it("passes scope narrowing and audience to atomic refresh", async () => {
    const response = await token(request({ grant_type: "refresh_token", refresh_token: "refresh", client_id: "client", resource, scope: "study" }));
    expect(response.status).toBe(200);
    expect(mocks.rotate).toHaveBeenCalledWith("refresh", "client", resource, ["study"]);
  });
  it("rejects repeated resource values before code consumption", async () => {
    const form = new URLSearchParams(codeForm);
    form.append("resource", resource);
    const response = await token(new Request("https://app.test", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});

describe("dynamic client registration", () => {
  const registration = (values: unknown) => register(new Request("https://app.test/api/oauth/register", { method: "POST", body: JSON.stringify(values) }));
  it("registers a public client", async () => {
    const response = await registration({ redirect_uris: ["https://client.test/cb"], token_endpoint_auth_method: "none" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ token_endpoint_auth_method: "none" });
  });
  it.each([
    { redirect_uris: ["https://client.test/cb", 5] },
    { redirect_uris: ["https://client.test/cb"], token_endpoint_auth_method: "client_secret_basic" },
    { redirect_uris: ["https://client.test/cb"], grant_types: ["password"] },
    { redirect_uris: ["https://client.test/cb"], response_types: ["token"] },
    { redirect_uris: ["file:///tmp/callback"] },
  ])("rejects unsupported metadata without persisting %j", async (values) => {
    expect((await registration(values)).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
