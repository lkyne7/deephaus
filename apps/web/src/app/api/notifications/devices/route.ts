import { NextResponse } from "next/server";
import { z } from "zod";
import { NOTIFICATION_PLATFORMS } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/exams/time";
import {
  deviceDto,
  registerDevice,
  removeDevice,
  saveNotificationPrefs,
} from "@/lib/notifications/prefs";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createServiceClient } from "@/lib/supabase/server";

const registerSchema = z
  .object({
    platform: z.enum(NOTIFICATION_PLATFORMS),
    token: z.string().min(8).max(2048),
    subscription: z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      })
      .passthrough()
      .optional(),
    label: z.string().max(120).optional(),
    timezone: z.string().max(100).refine(isValidTimeZone, "Invalid IANA timezone").optional(),
  })
  // A browser is reached at its subscription, so the two must agree.
  .refine(
    (body) => body.platform !== "web" || body.subscription?.endpoint === body.token,
    "A browser device needs its push subscription",
  );

const removeSchema = z
  .object({ id: z.string().uuid().optional(), token: z.string().min(8).max(2048).optional() })
  .refine((body) => body.id || body.token, "Say which device");

/** Register this browser or app for reminders, or refresh it. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid device" },
      { status: 400 },
    );
  }
  try {
    const device = await registerDevice(createServiceClient(), user!.id, parsed.data);
    // Reminder times are read in the zone the student's devices report.
    if (parsed.data.timezone) {
      await saveNotificationPrefs(supabase, user!.id, { timezone: parsed.data.timezone });
    }
    return NextResponse.json({ device: deviceDto(device) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not register this device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/notifications/devices");

export const DELETE = withApiTiming(async function DELETE(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid device" },
      { status: 400 },
    );
  }
  try {
    await removeDevice(supabase, user!.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove this device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "DELETE /api/notifications/devices");
