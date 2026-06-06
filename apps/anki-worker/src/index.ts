import "dotenv/config";
import { claimNextJob, createServiceClient, updateJob } from "./jobs.js";
import { removeStorageObject } from "./storage.js";
import { processJob } from "./process-job.js";

const POLL_INTERVAL_MS = Number(process.env.ANKI_WORKER_POLL_MS) || 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const supabase = createServiceClient();
  console.log(`[anki-worker] started; polling every ${POLL_INTERVAL_MS}ms`);

  let stopping = false;
  const stop = (signal: string) => {
    console.log(`[anki-worker] received ${signal}, finishing current job then exiting…`);
    stopping = true;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  while (!stopping) {
    let job;
    try {
      job = await claimNextJob(supabase);
    } catch (err) {
      console.error("[anki-worker] failed to claim job:", err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(
      `[anki-worker] processing job ${job.id} (${job.filename ?? "package"}, ${
        job.file_size ?? "?"
      } bytes, attempt ${job.attempts})`,
    );
    const startedAt = Date.now();
    try {
      await processJob(supabase, job);
      console.log(
        `[anki-worker] job ${job.id} ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed.";
      console.error(`[anki-worker] job ${job.id} failed:`, message);
      await updateJob(supabase, job.id, {
        status: "failed",
        progress: 100,
        error: message,
      });
      await removeStorageObject(supabase, job.storage_path);
    }
  }

  console.log("[anki-worker] stopped");
  process.exit(0);
}

main().catch((err) => {
  console.error("[anki-worker] fatal:", err);
  process.exit(1);
});
