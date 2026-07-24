/** Permanently delete a deck owned by the current user. */
export async function deleteProjectClient(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.status === 204) return;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "Could not delete deck.");
}

/** Duplicate a deck (cards + settings, fresh progress). */
export async function duplicateProjectClient(projectId: string): Promise<{
  id: string;
  name: string;
  deck_name: string;
  card_count: number;
}> {
  const res = await fetch(`/api/projects/${projectId}/duplicate`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | {
        id?: string;
        name?: string;
        deck_name?: string;
        card_count?: number;
        error?: string;
      }
    | null;
  if (!res.ok || !body?.id) {
    throw new Error(body?.error ?? "Could not duplicate deck.");
  }
  return {
    id: body.id,
    name: body.name ?? "Untitled deck",
    deck_name: body.deck_name ?? body.name ?? "Untitled deck",
    card_count: Number(body.card_count ?? 0),
  };
}
