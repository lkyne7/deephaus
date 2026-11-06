import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Generous for 200 short messages; anything larger isn't a conversation. */
const MAX_CONVERSATION_BYTES = 512 * 1024;

const bodySchema = z.object({
  conversation: z.object({
    version: z.literal(1),
    messages: z.array(z.record(z.unknown())).max(400),
    tasks: z.array(z.record(z.unknown())).max(400),
  }),
});

/** GET /api/projects/:id/conversation — the Create conversation saved for this deck. */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deck_conversations")
    .select("conversation")
    .eq("project_id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data?.conversation ?? null });
}, "GET /api/projects/[id]/conversation");

/** PUT /api/projects/:id/conversation — replace the saved conversation. */
export const PUT = withApiTiming(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireUser();
  if (response) return response;

  const raw = await request.text();
  if (raw.length > MAX_CONVERSATION_BYTES) {
    return NextResponse.json({ error: "Conversation is too large." }, { status: 413 });
  }
  const parsed = bodySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });
  }

  const { id } = await params;
  const supabase = await createClient();
  // Row-level security only admits decks this user owns.
  const { error } = await supabase.from("deck_conversations").upsert({
    project_id: id,
    conversation: parsed.data.conversation,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}, "PUT /api/projects/[id]/conversation");
