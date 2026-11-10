import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withApiTiming } from "@/lib/perf/with-api-timing";

const bodySchema = z
  .object({ opened: z.literal(true).optional(), shown: z.literal(true).optional() })
  .refine((body) => body.opened || body.shown, "Nothing to mark");

/**
 * Mark a reminder as opened (the student acted on it) or shown (the desktop
 * app displayed it). Opened reminders are how an ignored kind is told apart.
 */
export const PATCH = withApiTiming(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  const id = z.string().uuid().safeParse((await params).id);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const stamp = new Date().toISOString();
  const { error } = await supabase
    .from("notification_log")
    .update({
      ...(body.data.opened ? { opened_at: stamp } : {}),
      ...(body.data.shown ? { desktop_shown_at: stamp } : {}),
    })
    .eq("id", id.data)
    .eq("user_id", user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}, "PATCH /api/notifications/[id]");
