import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import {
  buildApkg,
  draftCardsToGenerated,
  type ExportCardProgress,
  type MediaFetcher,
} from "@deephaus/apkg";
import { extractCardMediaUrls, isAllowedImageSrc } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MEDIA_FETCH_TIMEOUT_MS = 8_000;
/** PostgREST returns at most this many rows per request. */
const PAGE_SIZE = 1000;
/** Card ids per `.in()` filter, keeping request URLs short. */
const ID_CHUNK = 200;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ExportCardRow = Parameters<typeof draftCardsToGenerated>[0][number] & { id: string };

async function loadExportCards(supabase: Supabase, jobIds: string[]): Promise<ExportCardRow[]> {
  const cards: ExportCardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, type, front, back, cloze_text, extra, tags")
      .in("job_id", jobIds)
      .in("type", ["basic", "cloze"])
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ExportCardRow[];
    cards.push(...page);
    if (page.length < PAGE_SIZE) return cards;
  }
}

/** Every row of `table` for these cards, paging past the PostgREST row cap. */
async function loadByCard<T extends { card_id: string }>(
  supabase: Supabase,
  table: "card_reviews" | "review_logs",
  columns: string,
  userId: string,
  cardIds: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < cardIds.length; i += ID_CHUNK) {
    const ids = cardIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase.from(table).select(columns).eq("user_id", userId).in("card_id", ids);
      if (table === "review_logs") query = query.eq("undone", false);
      const { data, error } = await query.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

/** The user's schedule and review history for each card, parallel to `cardIds`. */
async function loadExportProgress(
  supabase: Supabase,
  userId: string,
  cardIds: string[],
): Promise<Array<ExportCardProgress | undefined>> {
  type ReviewRow = {
    card_id: string; cloze_ord: number; due: string; stability: number; difficulty: number;
    scheduled_days: number; reps: number; lapses: number; state: number; suspended: boolean;
  };
  type LogRow = { card_id: string; cloze_ord: number | null; rating: number; state: number; scheduled_days: number; review: string };

  const [reviews, logs] = await Promise.all([
    loadByCard<ReviewRow>(supabase, "card_reviews",
      "card_id, cloze_ord, due, stability, difficulty, scheduled_days, reps, lapses, state, suspended", userId, cardIds),
    loadByCard<LogRow>(supabase, "review_logs",
      "id, card_id, cloze_ord, rating, state, scheduled_days, review", userId, cardIds),
  ]);

  const byCard = new Map<string, ExportCardProgress>();
  const entry = (cardId: string) => {
    let progress = byCard.get(cardId);
    if (!progress) byCard.set(cardId, (progress = { reviews: [], logs: [] }));
    return progress;
  };
  for (const r of reviews) {
    entry(r.card_id).reviews.push({
      clozeOrd: r.cloze_ord, due: r.due, stability: r.stability, difficulty: r.difficulty,
      scheduledDays: r.scheduled_days, reps: r.reps, lapses: r.lapses, state: r.state, suspended: r.suspended,
    });
  }
  for (const l of logs) {
    entry(l.card_id).logs.push({
      clozeOrd: l.cloze_ord ?? 0, rating: l.rating, state: l.state, scheduledDays: l.scheduled_days, review: l.review,
    });
  }
  return cardIds.map((id) => byCard.get(id));
}

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

  const { data: project } = await supabase
    .from("projects")
    .select("deck_name")
    .eq("id", projectId)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobId =
    typeof body.job_id === "string" && body.job_id.trim()
      ? body.job_id.trim()
      : null;

  let jobIds: string[];
  if (jobId) {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("id, sources!inner(projects!inner(user_id))")
      .eq("id", jobId)
      .eq("sources.projects.user_id", user!.id)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    jobIds = [jobId];
  } else {
    // Project-only export: gather every card in the deck across jobs.
    const { data: jobs } = await supabase
      .from("generation_jobs")
      .select("id, sources!inner(project_id, projects!inner(user_id))")
      .eq("sources.project_id", projectId)
      .eq("sources.projects.user_id", user!.id);

    jobIds = (jobs ?? []).map((job) => job.id as string);
    if (jobIds.length === 0) {
      return NextResponse.json({ error: "No cards to export" }, { status: 400 });
    }
  }

  let cards: ExportCardRow[];
  let progress: Array<ExportCardProgress | undefined> | undefined;
  try {
    cards = await loadExportCards(supabase, jobIds);
    if (body.include_progress !== false && cards.length > 0) {
      progress = await loadExportProgress(supabase, user!.id, cards.map((card) => card.id));
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
  if (!cards.length) {
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
