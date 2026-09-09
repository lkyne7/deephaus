import { apiFetch } from "@/lib/api/fetch";
import { readJson } from "@/lib/background-tasks/api";
import type { AssistantEditRequest, AssistantEditResponse } from "./assistant-edit";

/** Browser call for POST /api/cards/assistant-edit. */
export async function assistantEditCardsApi(
  body: AssistantEditRequest,
): Promise<AssistantEditResponse> {
  const res = await apiFetch("/api/cards/assistant-edit", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return readJson<AssistantEditResponse>(res);
}
