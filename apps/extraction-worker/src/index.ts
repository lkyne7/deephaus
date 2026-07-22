import "dotenv/config";
import { createServiceClient, resolveConfig } from "./config.js";
import { claimNextJob, updateJob } from "./jobs.js";
import { releaseWorkerCreditsForJob } from "./credits.js";
import { processJob } from "./process-job.js";
import { processPreviewJob } from "./process-preview-job.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(message: string): boolean {
  return /429|5\d\d|timeout|timed out|network|fetch failed|temporar|unavailable/i.test(
    message,
  );
}

async function main(): Promise<void> {
  const config = resolveConfig();
  const supabase = createServiceClient(config);
  const { error: probeError } = await supabase
    .from("source_extraction_jobs")
    .select("id")
    .limit(1);
  if (probeError) throw new Error(`Supabase connection failed: ${probeError.message}`);
  console.log(`[extraction-worker] ready; polling every ${config.pollMs}ms`);

  let stopping = false;
  const stop = (signal: string) => {
    console.log(`[extraction-worker] received ${signal}; stopping after the current job`);
    stopping = true;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  while (!stopping) {
    let job;
    try {
      job = await claimNextJob(supabase);
    } catch (error) {
      console.error(
        "[extraction-worker] claim failed:",
        error instanceof Error ? error.message : error,
      );
      await sleep(config.pollMs);
      continue;
    }
    if (!job) {
      await sleep(config.pollMs);
      continue;
    }

    const started = Date.now();
    console.log(
      `[extraction-worker] processing ${job.id} (${job.kind ?? "extract"}, ${job.file_size ?? "unknown"} bytes, attempt ${job.attempts})`,
    );
    try {
      if (job.kind === "preview") {
        await processPreviewJob(supabase, config, job);
      } else {
        await processJob(supabase, config, job);
      }
      console.log(
        `[extraction-worker] completed ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF extraction failed.";
      const retry = job.attempts < 3 && isTransient(message);
      console.error(`[extraction-worker] ${retry ? "retrying" : "failed"} ${job.id}: ${message}`);
      if (!retry) {
        await releaseWorkerCreditsForJob(supabase, job.id).catch(
          (releaseError) => {
            console.error(
              `[extraction-worker] failed to release OCR credits for ${job.id}:`,
              releaseError,
            );
          },
        );
      }
      await updateJob(supabase, job.id, retry
        ? {
            status: "pending",
            phase: "retrying",
            progress: 0,
            pages_completed: 0,
            error: message,
          }
        : {
            status: "failed",
            phase: "failed",
            progress: 100,
            error: message,
          });
    }
  }
}

main().catch((error) => {
  console.error(
    "[extraction-worker] fatal:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
