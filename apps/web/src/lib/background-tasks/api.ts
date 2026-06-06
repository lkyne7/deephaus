import type { DraftCard, GenerationJob } from "@deephaus/shared";

export async function readJson<T>(res: Response): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    try {
      const json = JSON.parse(body) as { error?: string };
      throw new Error(json.error ?? body);
    } catch (error) {
      if (error instanceof Error && error.message !== body) throw error;
      const trimmed = body.trim();
      if (/^internal server error$/i.test(trimmed)) {
        throw new Error(
          `Server error (${res.status}). Try refreshing the page and importing again. If it persists, check the dev server logs.`,
        );
      }
      throw new Error(trimmed || `Request failed (${res.status})`);
    }
  }
  return JSON.parse(body) as T;
}

export async function fetchJob(jobId: string): Promise<GenerationJob> {
  const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
  return readJson<GenerationJob>(res);
}

export type GenerateResponse = {
  job: GenerationJob;
  cards: DraftCard[];
};

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
