#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createDeepHausApi } from "./client.js";
import { loadHttpConfig } from "./config.js";
import { createDeepHausMcpServer } from "./server.js";

const transports = new Map<string, StreamableHTTPServerTransport>();

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID",
  );
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ReturnType<typeof loadHttpConfig>,
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const sessionHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  try {
    if (req.method === "POST") {
      const body = await readJsonBody(req);

      if (!transport && body && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (transport) transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id) transports.delete(id);
        };

        const api = createDeepHausApi(config);
        const server = createDeepHausMcpServer(api);
        await server.connect(transport);
      }

      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: invalid or missing session" },
            id: null,
          }),
        );
        return;
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!transport) {
        res.writeHead(400).end("Invalid or missing session ID");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end("Method not allowed");
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        }),
      );
    }
  }
}

async function main() {
  const config = loadHttpConfig();
  const httpServer = createServer((req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end("Not found");
      return;
    }
    void handleMcpRequest(req, res, config);
  });

  httpServer.listen(config.port, config.host, () => {
    console.error(
      `DeepHaus MCP HTTP server listening on http://${config.host}:${config.port}/mcp`,
    );
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
