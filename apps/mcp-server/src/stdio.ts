#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDeepHausMcpServer } from "@deephaus/mcp-core";
import { createDeepHausApi } from "./client.js";
import { loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  const api = createDeepHausApi(config);
  const server = createDeepHausMcpServer(() => api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
