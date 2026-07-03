export type McpServerConfig = {
  apiUrl: string;
  apiToken: string;
};

export function loadConfig(): McpServerConfig {
  const apiUrl = process.env.DEEPHAUS_API_URL?.trim();
  const apiToken = process.env.DEEPHAUS_API_TOKEN?.trim();

  if (!apiUrl) {
    throw new Error("DEEPHAUS_API_URL is required");
  }
  if (!apiToken) {
    throw new Error("DEEPHAUS_API_TOKEN is required");
  }
  if (!apiToken.startsWith("dh_")) {
    throw new Error("DEEPHAUS_API_TOKEN must be a DeepHaus personal access token (dh_...)");
  }

  return { apiUrl, apiToken };
}

export function loadHttpConfig(): McpServerConfig & { port: number; host: string } {
  const config = loadConfig();
  const port = Number(process.env.MCP_HTTP_PORT ?? "8787");
  const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("MCP_HTTP_PORT must be a positive number");
  }
  return { ...config, port, host };
}
