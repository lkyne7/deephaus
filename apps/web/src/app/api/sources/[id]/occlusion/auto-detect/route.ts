import { NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { JSONContent } from "@tiptap/core";
import {
  CARD_IMAGE_MIME_TYPES,
  MAX_CARD_IMAGE_BYTES,
  normalizeOcclusionRect,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/access";
import { detectOcclusionRectsByOcr } from "@/lib/occlusion/ocr";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { sourceDocumentHasImageUrl } from "@/lib/sources/source-document-images";
import { createClient } from "@/lib/supabase/server";
import { Agent, fetch as undiciFetch } from "undici";

export const runtime = "nodejs";
export const maxDuration = 60;

type SourceRow = {
  id: string;
  edited_content: JSONContent | null;
};

class ImageResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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

function isUnsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return isUnsafeIpv4(normalized);
  if (version !== 6) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isUnsafeIpv4(mapped[1]!);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    /^f[cd]/.test(normalized) ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function createSafeImageDispatcher(): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        void dnsLookup(hostname, { all: true, verbatim: true })
          .then((addresses) => {
            if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeAddress(address))) {
              callback(new ImageResponseError("The source image address is not public.", 400), "", 0);
              return;
            }
            const family =
              typeof options === "object" && "family" in options ? options.family : undefined;
            const selected =
              addresses.find((entry) => !family || entry.family === family) ?? addresses[0]!;
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

async function readBoundedImageResponse(response: Response): Promise<Buffer> {
  if (!response.ok) {
    throw new ImageResponseError(`Could not load the source image (${response.status}).`, 400);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !contentType ||
    !CARD_IMAGE_MIME_TYPES.includes(contentType as (typeof CARD_IMAGE_MIME_TYPES)[number])
  ) {
    throw new ImageResponseError("The source URL did not return a supported image.", 415);
  }

  const declaredBytes = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_CARD_IMAGE_BYTES) {
    throw new ImageResponseError("The source image exceeds the 5 MB limit.", 413);
  }
  if (!response.body) {
    throw new ImageResponseError("The source image response was empty.", 400);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_CARD_IMAGE_BYTES) {
      await reader.cancel();
      throw new ImageResponseError("The source image exceeds the 5 MB limit.", 413);
    }
    chunks.push(value);
  }
  if (totalBytes === 0) {
    throw new ImageResponseError("The source image response was empty.", 400);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const upgrade = await requirePlan(user!.id, "plus", "Automatic image occlusion");
  if (upgrade) return upgrade;

  let imageUrl: string;
  try {
    const body = (await request.json()) as { imageUrl?: unknown };
    if (typeof body.imageUrl !== "string" || !body.imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }
    const parsed = new URL(body.imageUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return NextResponse.json({ error: "imageUrl must use HTTP or HTTPS" }, { status: 400 });
    }
    if (parsed.username || parsed.password || parsed.port) {
      return NextResponse.json(
        { error: "imageUrl cannot include credentials or a custom port" },
        { status: 400 },
      );
    }
    if (isIP(parsed.hostname.replace(/^\[|\]$/g, "")) && isUnsafeAddress(parsed.hostname)) {
      return NextResponse.json({ error: "imageUrl must use a public address" }, { status: 400 });
    }
    imageUrl = body.imageUrl;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body or imageUrl" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("sources")
    .select("id, edited_content, projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", user!.id)
    .single();
  const source = data as SourceRow | null;

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  if (!sourceDocumentHasImageUrl(source.edited_content, imageUrl)) {
    return NextResponse.json(
      { error: "Image URL was not found in this source document" },
      { status: 400 },
    );
  }

  try {
    // Do not follow redirects: OCR may fetch only the exact URL authorized above.
    const dispatcher = createSafeImageDispatcher();
    let image: Buffer;
    try {
      const imageResponse = await undiciFetch(imageUrl, {
        redirect: "error",
        dispatcher,
      });
      image = await readBoundedImageResponse(imageResponse as unknown as Response);
    } finally {
      await dispatcher.close();
    }
    const rects = (await detectOcclusionRectsByOcr(image)).map(normalizeOcclusionRect);
    const occlusion_data: ImageOcclusionData = { imageUrl, rects };
    return NextResponse.json({ occlusion_data, added: rects.length });
  } catch (error) {
    if (error instanceof ImageResponseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Auto-detect failed";
    console.error("[sources/occlusion/auto-detect] failed:", message);
    return NextResponse.json({ error: "Could not auto-detect image regions." }, { status: 500 });
  }
}, "POST /api/sources/[id]/occlusion/auto-detect");
