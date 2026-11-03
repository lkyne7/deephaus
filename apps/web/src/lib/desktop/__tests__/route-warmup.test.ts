import { describe, expect, it } from "vitest";
import {
  buildWarmupUrls,
  CORE_ROUTES,
  extractStaticAssets,
  MAX_WARM_DECKS,
  studyRoutesForDecks,
  warmRoutes,
} from "../route-warmup";

const deckA = "c11a4fa8-fac0-4230-8938-c468e4ae1940";
const deckB = "0f3d4a2e-1b2c-4d5e-8f90-123456789abc";

describe("studyRoutesForDecks", () => {
  it("dedupes, validates ids and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const routes = studyRoutesForDecks([deckA, deckA, "../etc", ...many]);
    expect(routes[0]).toBe(`/decks/${deckA}/study`);
    expect(routes).toHaveLength(MAX_WARM_DECKS);
    expect(routes.some((r) => r.includes(".."))).toBe(false);
  });

  it("puts core routes before deck routes", () => {
    const urls = buildWarmupUrls([deckA]);
    expect(urls.slice(0, CORE_ROUTES.length)).toEqual([...CORE_ROUTES]);
    expect(urls.at(-1)).toBe(`/decks/${deckA}/study`);
  });
});

describe("extractStaticAssets", () => {
  it("finds Next.js chunks and stylesheets only", () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/app.css"/>
      <script src="/_next/static/chunks/main-abc.js" async></script>
      <script src="/_next/static/chunks/main-abc.js"></script>
      <img src="/brand/logo.png"/><script src="https://cdn.example.com/x.js"></script>`;
    expect(extractStaticAssets(html)).toEqual(["/_next/static/css/app.css", "/_next/static/chunks/main-abc.js"]);
  });
});

describe("warmRoutes", () => {
  it("fetches pages with HTML headers, then their assets once", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("/_next/")) return new Response("", { status: 200 });
      if (url === "/review") return new Response("nope", { status: 500 });
      return new Response(`<script src="/_next/static/chunks/shared.js"></script>`, { status: 200 });
    };
    const result = await warmRoutes(["/dashboard", "/review", `/decks/${deckB}/study`], fetchImpl);
    expect(result).toEqual({ pages: 2, assets: 1, failed: 1 });
    expect(calls.filter((c) => c.url === "/_next/static/chunks/shared.js")).toHaveLength(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/html");
    expect(calls[0].init?.credentials).toBe("include");
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    let count = 0;
    const fetchImpl = async () => {
      count += 1;
      controller.abort();
      return new Response("<html></html>", { status: 200 });
    };
    const result = await warmRoutes(["/dashboard", "/decks"], fetchImpl, controller.signal);
    expect(count).toBe(1);
    expect(result.pages).toBe(1);
  });
});
