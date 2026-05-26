import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { subscribeToPublication, unsubscribeFromPublication } from "@/lib/community/subscribe";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  sync_mode: z.enum(["follow", "fork"]),
});

export async function POST(request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "sync_mode must be follow or fork" }, { status: 400 });
  }

  const supabase = await createClient();

  try {
    const result = await subscribeToPublication(
      supabase,
      user!.id,
      id,
      parsed.data.sync_mode,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Subscribe failed";
    const status = message.includes("Already") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const supabase = await createClient();

  try {
    const result = await unsubscribeFromPublication(supabase, user!.id, id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unsubscribe failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
