import { describe, expect, it } from "vitest";
import { API_TOKEN_PREFIX, generateApiToken, hashApiToken, isApiToken, tokenHasScope } from "../api-token";

describe("API token helpers", () => {
  it("recognizes only Deephaus API token-shaped credentials", () => {
    expect(isApiToken(`${API_TOKEN_PREFIX}${"x".repeat(17)}`)).toBe(true);
    expect(isApiToken(`${API_TOKEN_PREFIX}${"x".repeat(16)}`)).toBe(false);
    expect(isApiToken(`Bearer ${API_TOKEN_PREFIX}${"x".repeat(32)}`)).toBe(false);
    expect(isApiToken("sk_not_a_deephaus_token")).toBe(false);
  });

  it("hashes tokens deterministically without retaining the original secret", () => {
    const token = `${API_TOKEN_PREFIX}test-token-material`;
    const hash = hashApiToken(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashApiToken(token));
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(hashApiToken(`${token}-changed`));
  });

  it("generates prefixed tokens with matching prefix and hash metadata", () => {
    const generated = generateApiToken();

    expect(generated.token).toMatch(/^dh_[A-Za-z0-9_-]+$/);
    expect(generated.prefix).toBe(generated.token.slice(0, 12));
    expect(generated.hash).toBe(hashApiToken(generated.token));
    expect(isApiToken(generated.token)).toBe(true);
  });

  it("allows exact scopes and wildcard scopes only", () => {
    expect(tokenHasScope(["study"], "study")).toBe(true);
    expect(tokenHasScope(["*"], "tokens")).toBe(true);
    expect(tokenHasScope(["study"], "tokens")).toBe(false);
  });
});
