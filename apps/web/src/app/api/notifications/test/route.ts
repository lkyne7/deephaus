import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sendReminder } from "@/lib/notifications/dispatch";
import { loadDevices } from "@/lib/notifications/prefs";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createServiceClient } from "@/lib/supabase/server";

/** Send a test reminder to every device the student has switched on. */
export const POST = withApiTiming(async function POST() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;
  try {
    const devices = (await loadDevices(supabase, user!.id)).filter((device) => device.enabled);
    if (devices.length === 0) {
      return NextResponse.json({ error: "Turn reminders on for a device first" }, { status: 409 });
    }
    const result = await sendReminder(
      createServiceClient(),
      user!.id,
      {
        kind: "test",
        examId: null,
        dedupeKey: `test:${randomUUID()}`,
        title: "Reminders are on",
        body: "This is what a study reminder from DeepHaus looks like.",
      },
      "/dashboard",
      devices,
    );
    return NextResponse.json({ deliveries: result.deliveries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send a test reminder";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/notifications/test");
