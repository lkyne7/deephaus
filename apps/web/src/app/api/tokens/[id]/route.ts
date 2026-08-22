import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { revokeGrantFamily } from "@/lib/oauth/tokens";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * DELETE /api/tokens/{id} — revoke a personal access token, or (for OAuth
 * tokens) the whole connected-app grant including its refresh tokens.
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
    .select("id, kind, client_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  // Revoking a connected app must also kill its refresh tokens, otherwise the
  // client would silently mint a fresh access token on its next refresh.
  if (data.kind === "oauth" && data.client_id) {
    await revokeGrantFamily(user!.id, data.client_id as string);
  }

  return NextResponse.json({ ok: true });
}, "DELETE /api/tokens/[id]");
