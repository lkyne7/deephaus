import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Workers beat once a minute; a few missed beats means the worker is down. */
const STALE_AFTER_MS = 5 * 60_000;
const WORKERS = ["extraction-worker", "anki-worker"] as const;

type Check = "ok" | "down";

/**
 * Public health check for an uptime monitor. Returns 503 when the database
 * can't be reached or a Render worker has stopped sending heartbeats. It
 * reports states only, never error text.
 */
export async function GET() {
  let database: Check = "ok";
  const workers: Record<string, Check> = Object.fromEntries(WORKERS.map((w) => [w, "down"]));

  try {
    const { data, error } = await createServiceClient().rpc("worker_heartbeats");
    if (error) throw error;
    const now = Date.now();
    for (const row of (data ?? []) as { worker: string; seen_at: string }[]) {
      if (row.worker in workers && now - Date.parse(row.seen_at) < STALE_AFTER_MS) {
        workers[row.worker] = "ok";
      }
    }
  } catch (error) {
    console.error("[health] database check failed:", error);
    database = "down";
  }

  const ok = database === "ok" && Object.values(workers).every((state) => state === "ok");
  return NextResponse.json(
    { ok, database, workers },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
