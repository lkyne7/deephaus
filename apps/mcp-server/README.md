# DeepHaus MCP Server

Connect Claude Desktop, ChatGPT, Cursor, or any MCP client to your DeepHaus account for FSRS-5 spaced repetition study inside any conversation.

## Two ways to connect

| Transport | Best for | Endpoint |
|-----------|----------|----------|
| **Hosted (Streamable HTTP)** | ChatGPT connectors, Cursor, Claude, any remote client | `https://<your-app>/api/mcp` with `Authorization: Bearer dh_…` |
| **Stdio (this package)** | Local development against a local web app | `node dist/stdio.js` |

The hosted server is multi-tenant: every request is authenticated by its own bearer token, so you never deploy anything yourself. This package is only the thin stdio binary for local development; all tools and prompts live in `@deephaus/mcp-core` and are shared with the hosted route (`apps/web/src/app/api/mcp/route.ts`).

## Prerequisites

1. A DeepHaus account with a **Pro** plan.
2. A personal access token from **Profile → MCP connections** in the web app. Tokens carry `study` and `write` scopes and can be given an expiry.

## Hosted server (recommended)

Point any Streamable HTTP MCP client at `https://<your-app>/api/mcp` and send `Authorization: Bearer dh_your_token`.

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "deephaus": {
      "url": "https://<your-app>/api/mcp",
      "headers": { "Authorization": "Bearer dh_your_token" }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "deephaus": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-app>/api/mcp",
        "--header",
        "Authorization: Bearer dh_your_token"
      ]
    }
  }
}
```

### ChatGPT

Add a custom connector with the hosted URL and the same `Authorization` header.

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
