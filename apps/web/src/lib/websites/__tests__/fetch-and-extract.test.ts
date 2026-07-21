import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("undici", () => ({
  Agent: class {
    async close() {}
  },
  fetch: fetchMock,
}));

import {
  WebsiteFetchError,
  fetchAndExtractWebsite,
  isUnsafeAddress,
  normalizeWebsiteUrl,
} from "@/lib/websites/fetch-and-extract";

describe("website URL safety", () => {
  it("rejects private, loopback, link-local, and documentation addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "192.0.2.4",
      "::1",
      "fd00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isUnsafeAddress(address), address).toBe(true);
    }
    expect(isUnsafeAddress("8.8.8.8")).toBe(false);
    expect(isUnsafeAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("normalizes fragments and rejects credentials or nonstandard ports", () => {
    expect(normalizeWebsiteUrl("https://example.com/a#section").toString()).toBe(
      "https://example.com/a",
    );
    expect(() => normalizeWebsiteUrl("https://user:pass@example.com")).toThrow(
      WebsiteFetchError,
    );
    expect(() => normalizeWebsiteUrl("https://example.com:8443")).toThrow(
      WebsiteFetchError,
    );
  });
});

describe("fetchAndExtractWebsite", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("extracts the readable article and canonical URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        `<!doctype html>
        <html>
          <head>
            <title>Ignored shell title</title>
            <link rel="canonical" href="/canonical-article">
          </head>
          <body>
            <nav>Navigation noise</nav>
            <article>
              <h1>Understanding spaced repetition</h1>
              <p>${"Spaced repetition improves durable memory by scheduling reviews near the point of forgetting. ".repeat(8)}</p>
              <script>window.bad = true</script>
            </article>
          </body>
        </html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
    );

    const result = await fetchAndExtractWebsite("https://example.com/article");
    expect(result.title).toBe("Ignored shell title");
    expect(result.canonicalUrl).toBe("https://example.com/canonical-article");
    expect(result.rawText).toContain("durable memory");
    expect(result.rawText).not.toContain("Navigation noise");
    expect(JSON.stringify(result.doc)).not.toContain("window.bad");
  });

  it("revalidates redirect targets and blocks redirects to private hosts", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/admin" },
      }),
    );

    await expect(fetchAndExtractWebsite("https://example.com/start")).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTML responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not html", { headers: { "Content-Type": "application/json" } }),
    );
    await expect(fetchAndExtractWebsite("https://example.com/data")).rejects.toThrow(
      "does not point to an HTML webpage",
    );
  });
});
