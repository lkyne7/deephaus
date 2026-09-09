import { apiFetch } from "@/lib/api/fetch";
import type { CardMnemonicResponse, RegenerateCardResponse } from "@/lib/cards/mnemonic";

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

/** Rewrite a card as an AnKing-style mnemonic card (same type); the server saves and returns the new fields. */
export function generateCardMnemonicApi(cardId: string): Promise<CardMnemonicResponse> {
  return postJson<CardMnemonicResponse>(`/api/cards/${cardId}/mnemonic`);
}

/** Rewrite a card from its source passage; the server saves and returns the new fields. */
export function regenerateCardApi(cardId: string): Promise<RegenerateCardResponse> {
  return postJson<RegenerateCardResponse>(`/api/cards/${cardId}/regenerate`);
}
