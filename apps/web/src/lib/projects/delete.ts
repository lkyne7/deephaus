import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseAiCredits } from "@/lib/credits/service";
import { isJobTerminal } from "@/lib/jobs/limits";
import { createServiceClient } from "@/lib/supabase/server";

const PDF_BUCKET = "pdfs";
const CARD_MEDIA_BUCKET = "card-media";
const MAX_LIST_FILES = 2000;

export class DeleteProjectError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DeleteProjectError";
    this.status = status;
  }
}

export type DeleteProjectResult = {
  projectId: string;
};

/**
 * Permanently delete a deck (project) owned by the user.
 *
 * Database rows cascade. Storage objects and reserved AI credit holds do not,
 * so we clean those up best-effort before deleting the project row.
 */
export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<DeleteProjectResult> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (projectError) {
    throw new DeleteProjectError(projectError.message, 500);
  }
  if (!project) {
    throw new DeleteProjectError("Deck not found", 404);
  }

  const { data: sources } = await supabase
    .from("sources")
    .select("id, storage_path, preview_storage_path")
    .eq("project_id", projectId);

  const sourceIds = (sources ?? []).map((row) => row.id as string);

  const { data: jobs } =
    sourceIds.length > 0
      ? await supabase
          .from("generation_jobs")
          .select("id, status, credit_transaction_id")
          .in("source_id", sourceIds)
      : { data: [] as Array<{ id: string; status: string; credit_transaction_id: string | null }> };

  const jobIds = (jobs ?? []).map((row) => row.id as string);

  const { data: extractionJobs } =
    sourceIds.length > 0
      ? await supabase
          .from("source_extraction_jobs")
          .select("id, status, credit_transaction_id")
          .in("source_id", sourceIds)
      : {
          data: [] as Array<{
            id: string;
            status: string;
            credit_transaction_id: string | null;
          }>,
        };

  const { data: cards } =
    jobIds.length > 0
      ? await supabase.from("cards").select("id").in("job_id", jobIds)
      : { data: [] as Array<{ id: string }> };

  const cardIds = (cards ?? []).map((row) => row.id as string);

  await releaseProjectCreditReservations(
    userId,
    jobs ?? [],
    extractionJobs ?? [],
  );
  await cleanupProjectStorage(userId, projectId, sources ?? [], sourceIds, cardIds);

  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);

  if (deleteError) {
    throw new DeleteProjectError(deleteError.message, 500);
  }

  return { projectId };
}

async function releaseProjectCreditReservations(
  userId: string,
  generationJobs: Array<{ id: string; status: string; credit_transaction_id: string | null }>,
  extractionJobs: Array<{ id: string; status: string; credit_transaction_id: string | null }>,
) {
  const keys = new Set<string>();

  for (const job of generationJobs) {
    if (job.credit_transaction_id && !isJobTerminal(job.status)) {
      keys.add(`generation:${job.id}`);
    }
  }

  for (const job of extractionJobs) {
    if (
      job.credit_transaction_id &&
      job.status !== "ready" &&
      job.status !== "failed" &&
      job.status !== "completed"
    ) {
      // Worker reserves OCR credits under pdf-ocr:{jobId}.
      keys.add(`pdf-ocr:${job.id}`);
    }
  }

  // Also release by looking up reserved transaction keys, in case formats differ.
  const transactionIds = [
    ...generationJobs.map((job) => job.credit_transaction_id),
    ...extractionJobs.map((job) => job.credit_transaction_id),
  ].filter((id): id is string => Boolean(id));

  if (transactionIds.length > 0) {
    const service = createServiceClient();
    const { data: transactions } = await service
      .from("ai_credit_transactions")
      .select("idempotency_key, status")
      .eq("user_id", userId)
      .eq("status", "reserved")
      .in("id", transactionIds);
    for (const row of transactions ?? []) {
      if (row.idempotency_key) keys.add(row.idempotency_key as string);
    }
  }

  await Promise.all(
    [...keys].map(async (idempotencyKey) => {
      try {
        await releaseAiCredits({ userId, idempotencyKey });
      } catch (error) {
        console.warn("[delete project] failed to release credit reservation", {
          idempotencyKey,
          error,
        });
      }
    }),
  );
}

async function cleanupProjectStorage(
  userId: string,
  projectId: string,
  sources: Array<{
    storage_path?: string | null;
    preview_storage_path?: string | null;
  }>,
  sourceIds: string[],
  cardIds: string[],
) {
  const service = createServiceClient();
  const pdfPaths = new Set<string>();

  for (const source of sources) {
    for (const path of [source.storage_path, source.preview_storage_path]) {
      if (path && !/^https?:\/\//i.test(path)) pdfPaths.add(path);
    }
  }

  // Source uploads live under `{userId}/{projectId}/…`.
  for (const path of await listStorageFolder(service, PDF_BUCKET, `${userId}/${projectId}`)) {
    pdfPaths.add(path);
  }

  const mediaPaths = new Set<string>();
  for (const sourceId of sourceIds) {
    for (const path of await listStorageFolder(
      service,
      CARD_MEDIA_BUCKET,
      `${userId}/source-media/${sourceId}`,
    )) {
      mediaPaths.add(path);
    }
  }
  for (const cardId of cardIds) {
    for (const path of await listStorageFolder(
      service,
      CARD_MEDIA_BUCKET,
      `${userId}/${cardId}`,
    )) {
      mediaPaths.add(path);
    }
  }

  await removePaths(service, PDF_BUCKET, [...pdfPaths]);
  await removePaths(service, CARD_MEDIA_BUCKET, [...mediaPaths]);
}

async function listStorageFolder(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [prefix];

  while (queue.length > 0 && paths.length < MAX_LIST_FILES) {
    const current = queue.shift()!;
    const { data: entries, error } = await service.storage
      .from(bucket)
      .list(current, { limit: 1000 });
    if (error || !entries) break;
    for (const entry of entries) {
      if (entry.id) paths.push(`${current}/${entry.name}`);
      else queue.push(`${current}/${entry.name}`);
    }
  }

  return paths;
}

async function removePaths(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  paths: string[],
) {
  if (paths.length === 0) return;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    await service.storage
      .from(bucket)
      .remove(batch)
      .catch((error) => {
        console.warn(`[delete project] storage cleanup failed for ${bucket}`, error);
      });
  }
}
