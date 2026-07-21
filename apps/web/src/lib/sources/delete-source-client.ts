import { readJson } from "@/lib/background-tasks/api";

/** Client helper for DELETE /api/sources/:id. */
export async function deleteSourceApi(sourceId: string): Promise<void> {
  const res = await fetch(`/api/sources/${sourceId}`, {
    method: "DELETE",
    credentials: "include",
  });
  await readJson<{ ok?: boolean; error?: string }>(res);
}
