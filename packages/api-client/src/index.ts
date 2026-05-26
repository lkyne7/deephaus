import type {
  DraftCard,
  GenerationJob,
  GenerationSettings,
  Project,
  Source,
} from "@deephaus/shared";

export interface DeepHausClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
}

async function request<T>(
  options: DeepHausClientOptions,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const token = await options.getAccessToken?.();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function createDeepHausClient(options: DeepHausClientOptions) {
  return {
    listProjects: () => request<Project[]>(options, "/api/projects"),
    createProject: (body: { name: string; deck_name: string; settings?: GenerationSettings }) =>
      request<Project>(options, "/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getProject: (id: string) => request<Project>(options, `/api/projects/${id}`),
    generateFromText: (
      projectId: string,
      text: string,
      settings?: Partial<GenerationSettings>,
    ) =>
      request<{
        source: Source;
        job: GenerationJob;
        cards: DraftCard[];
        mock?: boolean;
      }>(options, "/api/generate/text", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, text, settings }),
      }),
    addTextSource: (projectId: string, text: string) =>
      request<Source>(options, "/api/sources/text", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, text }),
      }),
    uploadPdfSource: (projectId: string, file: Blob | File, filename = "upload.pdf") => {
      const form = new FormData();
      form.append("project_id", projectId);
      form.append("file", file, filename);
      return request<Source>(options, "/api/sources/pdf", {
        method: "POST",
        body: form,
      });
    },
    startGeneration: (sourceId: string, settings?: Partial<GenerationSettings>) =>
      request<{ job: GenerationJob; cards: DraftCard[] }>(options, "/api/generate", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, settings }),
      }),
    getJob: (jobId: string) => request<GenerationJob>(options, `/api/jobs/${jobId}`),
    listCards: (jobId: string) =>
      request<DraftCard[]>(options, `/api/cards?job_id=${jobId}`),
    updateCard: (id: string, body: Partial<DraftCard>) =>
      request<DraftCard>(options, `/api/cards/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    deleteCard: (id: string) =>
      request<void>(options, `/api/cards/${id}`, { method: "DELETE" }),
    exportDeck: async (projectId: string, jobId: string) => {
      const token = await options.getAccessToken?.();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${options.baseUrl}/api/export`, {
        method: "POST",
        headers,
        body: JSON.stringify({ project_id: projectId, job_id: jobId }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.blob();
    },
  };
}

export type DeepHausClient = ReturnType<typeof createDeepHausClient>;
