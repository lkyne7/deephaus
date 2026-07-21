import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { stripNullBytes } from "@deephaus/pdf-extraction";
import type { JSONContent } from "@tiptap/core";
import { parseHTML } from "linkedom";
import { Agent, fetch as undiciFetch } from "undici";
import { htmlToSourceDoc } from "@/lib/sources/html-to-doc";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MIN_READABLE_CHARS = 50;

export type ExtractedWebsite = {
  title: string;
  canonicalUrl: string;
  doc: JSONContent;
  rawText: string;
};

export class WebsiteFetchError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "WebsiteFetchError";
    this.status = status;
  }
}

export function normalizeWebsiteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WebsiteFetchError("Enter a valid website URL.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebsiteFetchError("Website URLs must use http or https.", 400);
  }
  if (url.username || url.password) {
    throw new WebsiteFetchError("Website URLs cannot include credentials.", 400);
  }
  const standardPort =
    !url.port ||
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80");
  if (!standardPort) {
    throw new WebsiteFetchError("Website URLs must use a standard web port.", 400);
  }
  url.hash = "";
  return url;
}

function isUnsafeIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Block non-public ranges, including IPv4-mapped IPv6 addresses. */
export function isUnsafeAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isUnsafeIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isUnsafeIpv4(mapped[1]!);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    /^f[cd]/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:10:") ||
    normalized.startsWith("2001:20:")
  );
}

function createSafeDispatcher(): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        void dnsLookup(hostname, { all: true, verbatim: true })
          .then((addresses) => {
            if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeAddress(address))) {
              callback(new WebsiteFetchError("That address is not publicly reachable.", 400), "", 0);
              return;
            }
            const requestedFamily =
              typeof options === "object" && "family" in options ? options.family : undefined;
            const selected =
              addresses.find((entry) => !requestedFamily || entry.family === requestedFamily) ??
              addresses[0]!;
            if (typeof options === "object" && options.all) {
              callback(null, addresses as never);
            } else {
              callback(null, selected.address, selected.family);
            }
          })
          .catch((error: unknown) => {
            callback(error instanceof Error ? error : new Error("DNS lookup failed."), "", 0);
          });
      },
    },
  });
}

async function readBoundedBody(response: Awaited<ReturnType<typeof undiciFetch>>): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new WebsiteFetchError("That webpage is too large to import.", 413);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  if (!response.body) return "";
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_HTML_BYTES) {
      throw new WebsiteFetchError("That webpage is too large to import.", 413);
    }
    chunks.push(bytes);
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "";
}

async function fetchHtml(initialUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let current = initialUrl;

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (isIP(current.hostname) && isUnsafeAddress(current.hostname)) {
        throw new WebsiteFetchError("That address is not publicly reachable.", 400);
      }

      const dispatcher = createSafeDispatcher();
      try {
        const response = await undiciFetch(current, {
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "DeepHausSourceImporter/1.0 (+https://www.deephaus.ai)",
          },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new WebsiteFetchError("The website returned an invalid redirect.");
          current = normalizeWebsiteUrl(new URL(location, current).toString());
          continue;
        }
        if (!response.ok) {
          throw new WebsiteFetchError(`The website returned HTTP ${response.status}.`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
          throw new WebsiteFetchError("That URL does not point to an HTML webpage.");
        }
        return { html: await readBoundedBody(response), finalUrl: current };
      } finally {
        await dispatcher.close();
      }
    }
    throw new WebsiteFetchError("The website redirected too many times.");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new WebsiteFetchError("The website took too long to respond.", 408);
    }
    if (error instanceof WebsiteFetchError) throw error;
    throw new WebsiteFetchError(
      error instanceof Error ? `Could not fetch website: ${error.message}` : "Could not fetch website.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function safeCanonicalUrl(value: string | null, fallback: URL): string {
  if (!value) return fallback.toString();
  try {
    const candidate = normalizeWebsiteUrl(new URL(value, fallback).toString());
    return candidate.toString();
  } catch {
    return fallback.toString();
  }
}

function sanitizeArticleHtml(html: string, baseUrl: URL): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const selector of [
    "script",
    "style",
    "noscript",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "svg",
    "canvas",
    "video",
    "audio",
    "source",
    "picture",
    "img",
  ]) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  for (const anchor of document.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        anchor.setAttribute("href", resolved.toString());
      } else {
        anchor.removeAttribute("href");
      }
    } catch {
      anchor.removeAttribute("href");
    }
  }
  return document.body.innerHTML;
}

/** Fetch and turn a public webpage's main readable content into a source doc. */
export async function fetchAndExtractWebsite(input: string): Promise<ExtractedWebsite> {
  const requestedUrl = normalizeWebsiteUrl(input);
  const { html, finalUrl } = await fetchHtml(requestedUrl);
  const { document } = parseHTML(html);
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const article = new Readability(document as unknown as Document, {
    charThreshold: MIN_READABLE_CHARS,
  }).parse();
  if (!article?.content) {
    throw new WebsiteFetchError("Could not find enough readable content on that webpage.");
  }

  const cleanedHtml = sanitizeArticleHtml(article.content, finalUrl);
  const doc = htmlToSourceDoc(cleanedHtml);
  const rawText = stripNullBytes(sourceDocToPlainText(doc)).trim();
  if (rawText.length < MIN_READABLE_CHARS) {
    throw new WebsiteFetchError("Could not find enough readable content on that webpage.");
  }

  return {
    title: stripNullBytes(article.title?.trim() || finalUrl.hostname).slice(0, 240),
    canonicalUrl: safeCanonicalUrl(canonicalHref, finalUrl),
    doc,
    rawText,
  };
}
