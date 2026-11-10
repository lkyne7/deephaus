import { NextResponse } from "next/server";
import { z } from "zod";
import type { NotificationSettingsDto } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { vapidConfig } from "@/lib/notifications/config";
import {
  deviceDto,
  loadDevices,
  loadNotificationPrefs,
  saveNotificationPrefs,
} from "@/lib/notifications/prefs";
import { withApiTiming } from "@/lib/perf/with-api-timing";

const minuteOfDay = z.number().int().min(0).max(1439);

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    exam_reminders: z.boolean().optional(),
    daily_reviews: z.boolean().optional(),
    quiet_start: minuteOfDay.optional(),
    quiet_end: minuteOfDay.optional(),
    daily_time: minuteOfDay.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change");

async function settingsFor(
  supabase: Parameters<typeof loadDevices>[0],
  userId: string,
): Promise<NotificationSettingsDto> {
  const [stored, devices] = await Promise.all([
    loadNotificationPrefs(supabase, userId),
    loadDevices(supabase, userId),
  ]);
  return {
    prefs: stored.prefs,
    devices: devices.map(deviceDto),
    web_push_public_key: vapidConfig()?.publicKey ?? null,
  };
}

export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    return NextResponse.json(await settingsFor(supabase, user!.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load reminder settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/notifications/settings");

export const PATCH = withApiTiming(async function PATCH(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid settings" },
      { status: 400 },
    );
  }
  try {
    await saveNotificationPrefs(supabase, user!.id, parsed.data);
    return NextResponse.json(await settingsFor(supabase, user!.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save reminder settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "PATCH /api/notifications/settings");
