/** Persist a deck display name. Both columns stay in sync with create. */
export async function renameProject(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string; deck_name: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Deck name cannot be empty.");
  if (trimmed.length > 120) throw new Error("Deck name is too long.");

  const res = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: trimmed, deck_name: trimmed }),
  });

  const body = (await res.json().catch(() => null)) as
    | { id?: string; name?: string; deck_name?: string | null; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(body?.error ?? "Could not rename deck.");
  }
  return {
    id: body?.id ?? projectId,
    name: body?.name ?? trimmed,
    deck_name: body?.deck_name ?? trimmed,
  };
}
