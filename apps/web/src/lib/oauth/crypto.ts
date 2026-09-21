import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque secrets (auth codes, refresh tokens) are stored as sha256 hex. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOpaqueSecret(prefix: string): { secret: string; hash: string } {
  const secret = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { secret, hash: sha256Hex(secret) };
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
