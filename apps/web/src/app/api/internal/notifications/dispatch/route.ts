import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runReminderDispatch } from "@/lib/notifications/dispatch";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * One pass of the reminder dispatcher. Called once a minute by the worker,
 * with the same shared secret as the other internal routes.
 */
export async function POST(request: Request) {
  const expected = Buffer.from(process.env.EXTRACTION_WORKER_SECRET ?? "");
  const supplied = Buffer.from(
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  );
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runReminderDispatch(createServiceClient()));
  } catch (error) {
    console.error("[reminders] dispatch failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Reminders unavailable" }, { status: 503 });
  }
}
