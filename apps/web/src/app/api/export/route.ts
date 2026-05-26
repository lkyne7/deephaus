import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { buildApkg, draftCardsToGenerated, type MediaFetcher } from "@deephaus/apkg";
import { extractCardMediaUrls, isAllowedImageSrc } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MEDIA_FETCH_TIMEOUT_MS = 15_000;

async function fetchMediaBytes(url: string): Promise<Uint8Array | null> {
  if (!isAllowedImageSrc(url)) return null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) return null;

    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = await request.json();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("deck_name")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(projects!inner(user_id))")
    .eq("id", body.job_id)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data: cards, error } = await supabase
    .from("cards")
    .select("*")
    .eq("job_id", body.job_id)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cards?.length) {
    return NextResponse.json({ error: "No cards to export" }, { status: 400 });
  }

  const generated = draftCardsToGenerated(cards);
  const hasMedia = generated.some(
    (card) => extractCardMediaUrls(...(card.type === "basic"
      ? [card.front, card.back, card.extra]
      : [card.clozeText, card.extra])).length > 0,
  );

  const fetchMedia: MediaFetcher | undefined = hasMedia ? fetchMediaBytes : undefined;

  const result = await buildApkg({
    deckName: project.deck_name,
    cards: generated,
    description: "Exported from DeepHaus",
    fetchMedia,
  });

  const filename = `${project.deck_name.replace(/[^a-z0-9-_]+/gi, "-")}.apkg`;
  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-DeepHaus-Media-Bundled": String(result.mediaBundled),
      "X-DeepHaus-Media-Skipped": String(result.mediaSkipped),
    },
  });
}, "POST /api/export");
