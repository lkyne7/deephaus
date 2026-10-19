import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import {
  buildApkg,
  draftCardsToGenerated,
  type ExportCardProgress,
  type MediaFetcher,
} from "@deephaus/apkg";
import { loadExportCards, loadExportProgress, resolveExportTarget } from "@deephaus/anki-export";
import { extractCardMediaUrls, isAllowedImageSrc } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MEDIA_FETCH_TIMEOUT_MS = 8_000;

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

  const projectId =
    typeof body.project_id === "string" ? body.project_id.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const jobId =
    typeof body.job_id === "string" && body.job_id.trim()
      ? body.job_id.trim()
      : null;
  const target = await resolveExportTarget(supabase, user!.id, projectId, jobId);
  if (!target) {
    return NextResponse.json({ error: jobId ? "Job not found" : "Project not found" }, { status: 404 });
  }
  if (target.jobIds.length === 0) {
    return NextResponse.json({ error: "No cards to export" }, { status: 400 });
  }

  // Synchronous export, kept for older clients. It holds the whole package in
  // memory and returns it as one body, so large or media-heavy decks belong on
  // POST /api/export/enqueue instead.
  let cards: Awaited<ReturnType<typeof loadExportCards>>;
  let progress: Array<ExportCardProgress | undefined> | undefined;
  try {
    cards = await loadExportCards(supabase, target.jobIds);
    if (body.include_progress !== false && cards.length > 0) {
      progress = await loadExportProgress(supabase, user!.id, cards.map((card) => card.id));
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
  if (!cards.length) {
    return NextResponse.json({ error: "No cards to export" }, { status: 400 });
  }
  const project = { deck_name: target.deckName };

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
    progress,
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
      "X-DeepHaus-Scheduled-Exported": String(result.scheduledExported),
      "X-DeepHaus-Review-Logs-Exported": String(result.reviewLogsExported),
    },
  });
}, "POST /api/export");
