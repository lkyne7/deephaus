import type { SupabaseClient } from "@supabase/supabase-js";

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Records a heartbeat now and once a minute so GET /api/health can tell when
 * this worker has stopped. Logs only the first failure of a run of failures.
 * Returns a function that stops the timer.
 */
export function startHeartbeat(supabase: SupabaseClient, worker: string): () => void {
  let failing = false;
  const beat = async () => {
    let message: string | null = null;
    try {
      const { error } = await supabase.rpc("record_worker_heartbeat", { p_worker: worker });
      message = error?.message ?? null;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (message && !failing) console.error(`[${worker}] heartbeat failed: ${message}`);
    failing = message !== null;
  };
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
