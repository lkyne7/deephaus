import { NextResponse } from "next/server";
import { z } from "zod";
import { embedQuery } from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
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

  if (USE_MOCK_LLM || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      results: [],
      note: "Semantic search is unavailable without an embedding model configured.",
    });
  }

  const embedding = await embedQuery(body.query, { apiKey: process.env.OPENAI_API_KEY });
  if (!embedding) {
    return NextResponse.json({ results: [], note: "Could not embed the query." });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_source_chunks", {
    p_query_embedding: `[${embedding.join(",")}]`,
    p_project_id: body.project_id ?? null,
    p_source_id: body.source_id ?? null,
    p_match_count: body.match_count ?? 8,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}, "POST /api/sources/search");
