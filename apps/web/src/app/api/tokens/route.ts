import { NextResponse } from "next/server";
import { z } from "zod";
import { generateApiToken, type ApiTokenRow } from "@/lib/auth/api-token";
import { requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/access";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createServiceClient } from "@/lib/supabase/server";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

function serializeToken(row: ApiTokenRow) {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes: row.scopes,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

/**
 * GET /api/tokens — list active personal access tokens (prefix only).
 * POST /api/tokens — create a token; full secret returned once.
 */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, name, token_prefix, scopes, last_used_at, created_at, revoked_at")
    .eq("user_id", user!.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    tokens: (data ?? []).map((row) => serializeToken(row as ApiTokenRow)),
  });
}, "GET /api/tokens");

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const upgrade = await requirePlan(user!.id, "pro", "MCP access");
  if (upgrade) return upgrade;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof z.ZodError ? e.errors[0]?.message : "Invalid body" },
      { status: 400 },
    );
  }

  const { token, prefix, hash } = generateApiToken();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      user_id: user!.id,
      name: body.name,
      token_prefix: prefix,
      token_hash: hash,
      scopes: ["study"],
    })
    .select("id, name, token_prefix, scopes, last_used_at, created_at, revoked_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create token" }, { status: 500 });
  }

  return NextResponse.json(
    {
      token,
      ...serializeToken(data as ApiTokenRow),
    },
    { status: 201 },
  );
}, "POST /api/tokens");
