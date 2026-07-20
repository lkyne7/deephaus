import type { DraftCard, GenerationJob } from "@deephaus/shared";

function errorMessageFromBody(status: number, body: string): string {
  const trimmed = body.trim();
  try {
    const json = JSON.parse(trimmed) as { error?: string };
    if (typeof json.error === "string" && json.error.trim()) {
      return json.error.trim();
    }
  } catch {
    // Platform proxies often return plain text (e.g. "Request Entity Too Large").
  }

  if (
    status === 413 ||
    /request entity too large|payload too large|entity too large/i.test(trimmed)
  ) {
    return (
      "This file is too large for a direct browser upload (about 4 MB max on this path). " +
      "Large PDFs are uploaded to storage instead — try again, or compress the file."
    );
  }

  if (/^internal server error$/i.test(trimmed)) {
    return (
      `Server error (${status}). Try refreshing the page and importing again. ` +
      "If it persists, check the server logs."
    );
  }

  return trimmed || `Request failed (${status})`;
}

export async function readJson<T>(res: Response): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    throw new Error(errorMessageFromBody(res.status, body));
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      body.trim()
        ? errorMessageFromBody(res.status || 500, body)
        : `Invalid server response (${res.status})`,
    );
  }
}

export async function fetchJob(jobId: string): Promise<GenerationJob & { card_count?: number }> {
  const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
  return readJson<GenerationJob & { card_count?: number }>(res);
}

export type GenerateResponse = {
  job: GenerationJob;
  cards: DraftCard[];
};

export type SourceExtractionJob = {
  id: string;
  source_id: string;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string;
  progress: number;
  pages_total: number | null;
  pages_completed: number;
  quality_score: number | null;
  generation_job_id: string | null;
  error: string | null;
};

export type EnqueueSourceExtractionResponse = {
  source: { id: string; project_id: string };
  extraction_job: SourceExtractionJob;
};

export async function fetchSourceExtractionJob(
  jobId: string,
): Promise<SourceExtractionJob> {
  const res = await fetch(`/api/source-extractions/${jobId}`, {
    credentials: "include",
  });
  return readJson<SourceExtractionJob>(res);
}

export type AnkiImportResult = {
  decks: Array<{ id: string; name: string; cardCount: number }>;
  cardsImported: number;
  scheduledImported: number;
  suspendedImported: number;
  mediaImported: number;
  mediaSkipped: number;
  fsrsPresetsApplied: number;
};

export type AnkiImportJob = {
  id: string;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string | null;
  progress: number;
  error: string | null;
  result: AnkiImportResult | null;
  filename: string | null;
};

export async function fetchAnkiImportJob(jobId: string): Promise<AnkiImportJob> {
  const res = await fetch(`/api/import/anki/jobs/${jobId}`, { credentials: "include" });
  return readJson<AnkiImportJob>(res);
}

export type EnqueueAnkiImportResponse = {
  jobId: string;
  inline: boolean;
};
