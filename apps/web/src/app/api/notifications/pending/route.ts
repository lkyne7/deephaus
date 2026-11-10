import { NextResponse } from "next/server";
import type { ReminderDto } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { withApiTiming } from "@/lib/perf/with-api-timing";

/** A reminder older than this is stale by the time the app is opened. */
const FRESH_MS = 15 * 60_000;

/**
 * Reminders the desktop app has not shown yet. The desktop shell has no push
 * service of its own, so while it is open it asks for these and shows them.
 */
export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  const { data, error } = await supabase
    .from("notification_log")
    .select("id, kind, title, body, path, sent_at")
    .eq("user_id", user!.id)
    .is("desktop_shown_at", null)
    .gte("sent_at", new Date(Date.now() - FRESH_MS).toISOString())
    .order("sent_at", { ascending: true })
    .limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminders: (data ?? []) as ReminderDto[] });
}, "GET /api/notifications/pending");
