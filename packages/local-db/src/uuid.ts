/**
 * RFC 4122 v4 UUID using the platform CSPRNG. Web and Node provide
 * `crypto.randomUUID`; React Native (Hermes) needs the
 * `react-native-get-random-values` polyfill for `getRandomValues`.
 */
export function generateUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      "crypto.getRandomValues is unavailable — import 'react-native-get-random-values' before @deephaus/local-db",
    );
  }
  const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
