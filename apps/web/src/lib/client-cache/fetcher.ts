"use client";

import { apiFetch } from "@/lib/api/fetch";

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

/** JSON fetcher for SWR — includes session cookies + bearer token. */
export async function swrFetcher<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url);
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Network request failed";
    throw new Error(message === "Failed to fetch" ? "Could not reach the server" : message);
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body || `Request failed (${res.status})`;
    try {
      const json = JSON.parse(body) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // use raw body
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
