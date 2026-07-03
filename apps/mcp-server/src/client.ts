import { createBearerClient, type DeepHausClient } from "@deephaus/api-client";
import type { McpServerConfig } from "./config.js";

export function createDeepHausApi(config: McpServerConfig): DeepHausClient {
  return createBearerClient(config.apiUrl, async () => config.apiToken);
}
