import { fetchWithDeadline } from "@deephaus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Reads an ArrayBuffer body the way React Native's Response polyfill does. */
class ByteResponse extends Response {
  private rawBytes: Uint8Array;

  constructor(body: ArrayBuffer | null, init?: ResponseInit) {
    super(body, init);
    this.rawBytes = new Uint8Array(body ?? new ArrayBuffer(0));
  }

  override async text() {
    return Array.from(this.rawBytes, (byte) => String.fromCharCode(byte)).join("");
  }

  override async json() {
    return JSON.parse(await this.text());
  }
}

describe("fetchWithDeadline text decoding", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps UTF-8 intact where Response decodes byte by byte", async () => {
    const title = "Here’s photosystème … ok";
    vi.stubGlobal("fetch", async () => new globalThis.Response(JSON.stringify({ title })));
    vi.stubGlobal("Response", ByteResponse);

    const response = await fetchWithDeadline("https://example.test/api");

    await expect(response.json()).resolves.toEqual({ title });
  });

  it("reads text as UTF-8 too", async () => {
    vi.stubGlobal("fetch", async () => new globalThis.Response("chemical energy. …"));
    vi.stubGlobal("Response", ByteResponse);

    const response = await fetchWithDeadline("https://example.test/api");

    await expect(response.text()).resolves.toBe("chemical energy. …");
  });
});
