import type { DeepHausClientOptions } from "./options.js";
import { createDeepHausClient } from "./client.js";

export function createBearerClient(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
) {
  return createDeepHausClient({
    baseUrl,
    auth: { type: "bearer", getAccessToken },
  });
}

export function createWebClient(baseUrl: string) {
  return createDeepHausClient({ baseUrl, auth: { type: "credentials" } });
}

export type { DeepHausClientOptions };
