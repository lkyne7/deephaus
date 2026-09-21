# DeepHaus MCP Server

Connect Claude Desktop, ChatGPT, Cursor, or any MCP client to your DeepHaus account for FSRS-5 spaced repetition study inside any conversation.

## Two ways to connect

| Transport | Best for | Endpoint |
|-----------|----------|----------|
| **Hosted (Streamable HTTP)** | ChatGPT connectors, Cursor, Claude, any remote client | `https://<your-app>/api/mcp` with OAuth (or a personal bearer token) |
| **Stdio (this package)** | Local development against a local web app | `node dist/stdio.js` |

The hosted server is multi-tenant: every request is authenticated by its own bearer token, so you never deploy anything yourself. This package is only the thin stdio binary for local development; all tools and prompts live in `@deephaus/mcp-core` and are shared with the hosted route (`apps/web/src/app/api/mcp/route.ts`).

## Prerequisites

A DeepHaus account with a **Pro** plan. Hosted clients connect with OAuth:
users sign in to DeepHaus and approve access without copying a token.
Personal access tokens remain available for local development and clients that
support custom authorization headers.

## Hosted server (recommended)

Production endpoint: `https://www.deephaus.ai/api/mcp` (Streamable HTTP).

- **ChatGPT:** Enable Developer mode, add the endpoint from Plugins, select OAuth,
  and complete DeepHaus sign-in. Do not configure a manual Authorization header.
- **Claude:** Customize → Connectors → Add custom connector. Enter the endpoint,
  then connect and authorize. No local Node.js bridge is needed.
- **Cursor:** Use **Add to Cursor** in DeepHaus → Profile → MCP connections,
  or configure `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "deephaus": { "url": "https://www.deephaus.ai/api/mcp" }
  }
}
```

Approve OAuth when prompted. Revoke access in DeepHaus → Profile → MCP connections.
Organization administrators may need to enable custom integrations.

## Plugin distribution

[`plugins/deephaus`](../../plugins/deephaus/README.md) contains the portable plugin
and Claude compatibility manifests, plus shared study and card-creation skills.
See the [distribution checklist](../../docs/mcp-distribution.md) for submission
materials, current blockers, and platform review steps. Packages are prepared
locally; no public marketplace listing has been submitted or approved.

## Stdio (local development)

### Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPHAUS_API_URL` | Yes | DeepHaus web app URL (e.g. `http://localhost:3000`) |
| `DEEPHAUS_API_TOKEN` | Yes | Personal access token (`dh_...`) |

### Build and run

```bash
pnpm --filter @deephaus/api-client build
pnpm --filter @deephaus/mcp-core build
pnpm --filter @deephaus/mcp-server build

DEEPHAUS_API_URL=http://localhost:3000 \
DEEPHAUS_API_TOKEN=dh_your_token \
pnpm --filter @deephaus/mcp-server start
```

### Claude Desktop (local stdio)

```json
{
  "mcpServers": {
    "deephaus": {
      "command": "node",
      "args": ["/absolute/path/to/deephaus/apps/mcp-server/dist/stdio.js"],
      "env": {
        "DEEPHAUS_API_URL": "http://localhost:3000",
        "DEEPHAUS_API_TOKEN": "dh_your_token"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Tools

| Tool | Scope | Description |
|------|-------|-------------|
| `list_decks` | study | Decks with due/new counts |
| `get_study_queue` | study | Next cards to review (question-only by default) |
| `submit_review` | study | Grade a card (again/hard/good/easy) |
| `get_card` | study | Full card for answer reveal |
| `browse_cards` | study | Search/browse cards by text, tag, or deck |
| `get_deck_stats` | study | Per-deck stats |
| `get_study_stats` | study | Dashboard stats |
| `create_deck` | write | Create a new deck |
| `create_cards` | write | Batch-create cards (per-card validation; partial failures reported) |
| `update_card` | write | Edit a card's content or tags |
| `delete_card` | write | Permanently delete a card |
| `rename_deck` | write | Rename a deck |

## Prompts

| Prompt | Description |
|--------|-------------|
| `deephaus_study_session` | Step-by-step FSRS review protocol for the host AI |

## Example chat prompts

- "Turn this explanation into flashcards and save them to DeepHaus."
- "Quiz me on my due cards using spaced repetition."
- "Create a deck from our conversation and start a study session."

## Security

- Treat `DEEPHAUS_API_TOKEN` like a password; revoke it from Profile → MCP connections if exposed.
- Tokens are Pro-gated, SHA-256 hashed at rest, scoped (`study`/`write`), support optional expiry, and are rate-limited (best-effort 120 req/min per token).
- The hosted route authenticates every request independently; no server-side token configuration is required.
