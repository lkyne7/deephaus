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
