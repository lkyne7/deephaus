import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDeepHausMcpServer } from "@deephaus/mcp-core";

async function connect(t, api = {}) {
  const server = createDeepHausMcpServer(() => api);
  const client = new Client({ name: "distribution-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("all tools publish explicit review annotations over MCP", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  const readOnly = new Set(["list_decks", "get_study_queue", "get_card", "browse_cards", "get_deck_stats", "get_study_stats"]);
  const destructive = new Set(["submit_review", "update_card", "delete_card", "rename_deck"]);
  assert.equal(tools.length, 12);
  for (const tool of tools) {
    assert.ok(tool.title, tool.name);
    assert.equal(tool.annotations.readOnlyHint, readOnly.has(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, destructive.has(tool.name), tool.name);
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
  }
  // Hosts without MCP prompt support must still receive the study protocol.
  assert.match(client.getInstructions(), /Never grade automatically/);
});

test("creation reports partial failures without hiding successful writes", async (t) => {
  const saved = [];
  const client = await connect(t, {
    createCard: async (card) => { saved.push(card); return { id: "saved-card", ...card }; },
  });
  const result = await client.callTool({ name: "create_cards", arguments: {
    deck_id: "00000000-0000-4000-8000-000000000001",
    cards: [{ front: "Capital of France?", back: "Paris" }, { front: "Missing answer" }],
  } });
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.created_count, 1);
  assert.equal(data.failed_count, 1);
  assert.equal(data.failed[0].index, 1);
  assert.equal(saved.length, 1);
  assert.notEqual(result.isError, true);
});

test("invalid review grades cannot reach the API", async (t) => {
  let calls = 0;
  const client = await connect(t, { submitReview: async () => { calls++; } });
  const result = await client.callTool({ name: "submit_review", arguments: {
    card_id: "00000000-0000-4000-8000-000000000001", grade: "perfect",
  } });
  assert.equal(result.isError, true);
  assert.equal(calls, 0);
});

test("portable and Claude packages use the same endpoint without credentials", async () => {
  const root = new URL("../../../plugins/deephaus/", import.meta.url);
  const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
  const portable = await json("plugin.json");
  const claude = await json(".claude-plugin/plugin.json");
  assert.equal(portable.name, claude.name);
  assert.equal(portable.version, claude.version);
  const config = await json("mcp.json");
  const legacy = await json(".mcp.json");
  assert.equal(claude.mcpServers, "./.mcp.json");
  assert.deepEqual(config.mcpServers.deephaus, {
    type: "streamable-http", url: "https://www.deephaus.ai/api/mcp",
  });
  assert.deepEqual(legacy.mcpServers.deephaus, {
    type: "http", url: config.mcpServers.deephaus.url,
  });
});
