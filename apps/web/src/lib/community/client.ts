import { apiFetch } from "@/lib/api/fetch";
import { cacheKeys } from "@/lib/client-cache/keys";
import type {
  CommunityDeckRow,
  DeckPublication,
  PublicationCard,
  PublicationFacts,
  SyncMode,
} from "@/lib/community/types";

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

const json = { "Content-Type": "application/json" };

export type CommunityDeckDetail = {
  publication: CommunityDeckRow;
  previewCards: PublicationCard[];
  /** Cards per type and top tags; only on the first page, and null before the listing migration. */
  facts: PublicationFacts | null;
};

/**
 * The catalog straight from the server. The list response may be reused by the
 * browser for half a minute, which right after adding, rating or publishing
 * would bring back the state from before; `reload` skips that copy and replaces it.
 */
export async function fetchCommunityCatalog(): Promise<CommunityDeckRow[]> {
  const res = await apiFetch(cacheKeys.communityDecks, { cache: "reload" });
  if (!res.ok) throw await failure(res, "Could not load community decks");
  return (await res.json()) as CommunityDeckRow[];
}

export function communityDeckKey(publicationId: string): string {
  return `/api/community/decks/${publicationId}`;
}

/** A page of a published deck's cards, for "Show more" and "Try cards". */
export async function fetchCommunityCards(
  publicationId: string,
  offset: number,
  limit: number,
): Promise<PublicationCard[]> {
  const res = await fetch(`${communityDeckKey(publicationId)}?offset=${offset}&limit=${limit}`, {
    credentials: "include",
  });
  if (!res.ok) throw await failure(res, "Could not load more cards");
  const data = (await res.json()) as CommunityDeckDetail;
  return data.previewCards ?? [];
}

export async function addCommunityDeck(
  publicationId: string,
  mode: SyncMode,
): Promise<{ localProjectId: string }> {
  const res = await fetch(`${communityDeckKey(publicationId)}/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ sync_mode: mode }),
  });
  if (!res.ok) throw await failure(res, "Could not add this deck");
  return (await res.json()) as { localProjectId: string };
}

/** Stop following the author's updates; the copy becomes the user's own. */
export async function stopFollowingCommunityDeck(publicationId: string): Promise<void> {
  const res = await fetch(`${communityDeckKey(publicationId)}/subscribe`, {
    method: "PATCH",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ sync_mode: "fork" }),
  });
  if (!res.ok) throw await failure(res, "Could not update this deck");
}

export async function rateCommunityDeck(
  publicationId: string,
  stars: number | null,
): Promise<{ my_rating: number | null; avg_rating: number; rating_count: number }> {
  const res = await fetch(`${communityDeckKey(publicationId)}/rating`, {
    method: stars === null ? "DELETE" : "PUT",
    credentials: "include",
    headers: stars === null ? undefined : json,
    body: stars === null ? undefined : JSON.stringify({ stars }),
  });
  if (!res.ok) throw await failure(res, stars === null ? "Could not clear rating" : "Could not save rating");
  return res.json();
}

export type ListingFields = { title?: string; description?: string | null; subject?: string | null };

/** Publish a deck, or republish it so people who follow it get the current cards. */
export async function publishDeck(projectId: string, listing: ListingFields): Promise<DeckPublication> {
  const res = await fetch("/api/community/publish", {
    method: "POST",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ project_id: projectId, ...listing }),
  });
  if (!res.ok) throw await failure(res, "Publish failed");
  return res.json();
}

/** Change the listing's words without republishing the cards. */
export async function saveListing(projectId: string, listing: ListingFields): Promise<DeckPublication> {
  const res = await fetch("/api/community/publish", {
    method: "PATCH",
    credentials: "include",
    headers: json,
    body: JSON.stringify({ project_id: projectId, ...listing }),
  });
  if (!res.ok) throw await failure(res, "Could not save the listing");
  return res.json();
}

export async function unpublishDeck(projectId: string): Promise<void> {
  const res = await fetch(`/api/community/publish?project_id=${projectId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw await failure(res, "Unpublish failed");
}

export async function fetchPublication(projectId: string): Promise<DeckPublication | null> {
  const res = await fetch(`/api/community/publish?project_id=${projectId}`, { credentials: "include" });
  if (!res.ok) throw await failure(res, "Could not load the listing");
  return res.json();
}
