import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * DELETE /api/tokens/{id} — revoke a personal access token.
 */
export const DELETE = withApiTiming(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user!.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}, "DELETE /api/tokens/[id]");
