import { NextResponse } from "next/server";
import { z } from "zod";
import { embedQuery } from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const bodySchema = z.object({
  query: z.string().min(2),
  project_id: z.string().uuid().optional(),
  source_id: z.string().uuid().optional(),
  match_count: z.number().int().min(1).max(25).optional(),
});

const USE_MOCK_LLM = process.env.DEEPHAUS_USE_MOCK_LLM === "true";

/**
 * POST /api/sources/search — semantic retrieval over a user's persisted source
 * chunks. Returns the closest segments by cosine similarity.
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid request body";
    return NextResponse.json({ error: message ?? "Invalid request body" }, { status: 400 });
  }

  const supabase = await createClient();
  if (body.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", body.project_id)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  if (body.source_id) {
    let query = supabase
      .from("sources")
      .select("id, project_id, projects!inner(user_id)")
      .eq("id", body.source_id)
      .eq("projects.user_id", user!.id);
    if (body.project_id) query = query.eq("project_id", body.project_id);
    const { data: source } = await query.maybeSingle();
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
  }

  if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      results: [],
      note: "Semantic search is unavailable without an embedding model configured.",
    });
  }

  const idempotencyKey = creditIdempotencyKey(
    user!.id,
    "source-search",
    request.headers.get("idempotency-key"),
  );
  let reserved = false;

  try {
    await reserveAiCredits({
      userId: user!.id,
      idempotencyKey,
      action: "source-search",
      reservedCredits: 1,
      resourceType: body.source_id ? "source" : body.project_id ? "project" : undefined,
      resourceId: body.source_id ?? body.project_id,
    });
    reserved = true;

    const embedding = await embedQuery(body.query, {
      apiKey: process.env.OPENAI_API_KEY,
    });
    if (!embedding) {
      await releaseAiCredits({
        userId: user!.id,
        idempotencyKey,
      });
      reserved = false;
      return NextResponse.json({ results: [], note: "Could not embed the query." });
    }

    const { data, error } = await supabase.rpc("match_source_chunks", {
      p_query_embedding: `[${embedding.join(",")}]`,
      p_project_id: body.project_id ?? null,
      p_source_id: body.source_id ?? null,
      p_match_count: body.match_count ?? 8,
    });

    if (error) throw new Error(error.message);

    await settleAiCredits({
      userId: user!.id,
      idempotencyKey,
      chargedCredits: 1,
    });
    return NextResponse.json({ results: data ?? [] });
  } catch (error) {
    if (reserved) {
      try {
        await releaseAiCredits({ userId: user!.id, idempotencyKey });
      } catch (releaseError) {
        console.error("[source search credits] failed to release reservation", releaseError);
      }
    }
    if (isAiCreditsExhaustedError(error)) {
      return aiCreditsExhaustedResponse(error);
    }
    const message = error instanceof Error ? error.message : "Source search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/sources/search");
