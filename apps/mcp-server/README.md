# DeepHaus MCP Server

Connect Claude Desktop, ChatGPT, Cursor, or any MCP client to your DeepHaus account for FSRS-5 spaced repetition study inside any conversation.

## Prerequisites

1. A DeepHaus account with at least one deck (or create decks via MCP).
2. A personal access token from **Profile → MCP connections** in the web app.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPHAUS_API_URL` | Yes | DeepHaus web app URL (e.g. `http://localhost:3000` or `https://app.deephaus.com`) |
| `DEEPHAUS_API_TOKEN` | Yes | Personal access token (`dh_...`) |
| `MCP_HTTP_HOST` | No | HTTP bind host (default `127.0.0.1`) |
| `MCP_HTTP_PORT` | No | HTTP bind port (default `8787`) |

## Build

```bash
pnpm --filter @deephaus/api-client build
pnpm --filter @deephaus/mcp-server build
```

## Stdio (Claude Desktop, Cursor)

```bash
DEEPHAUS_API_URL=http://localhost:3000 \
DEEPHAUS_API_TOKEN=dh_your_token \
pnpm --filter @deephaus/mcp-server start
```

### Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

## HTTP (ChatGPT Connectors, remote clients)

```bash
DEEPHAUS_API_URL=http://localhost:3000 \
DEEPHAUS_API_TOKEN=dh_your_token \
pnpm --filter @deephaus/mcp-server start:http
```

The server listens at `http://127.0.0.1:8787/mcp`. For ChatGPT or other remote connectors, expose this endpoint (e.g. via a tunnel) and configure the connector URL to `https://your-host/mcp`.

## Tools

| Tool | Description |
|------|-------------|
| `list_decks` | Decks with due/new counts |
| `get_study_queue` | Next cards to review (question-only by default) |
| `submit_review` | Grade a card (again/hard/good/easy) |
| `create_deck` | Create a new deck |
| `create_cards` | Batch-create cards from chat content |
| `get_card` | Full card for answer reveal |
| `get_study_stats` | Dashboard stats |

## Prompts

| Prompt | Description |
|--------|-------------|
| `deephaus_study_session` | Step-by-step FSRS review protocol for the host AI |

## Example chat prompts

- "Turn this explanation into flashcards and save them to DeepHaus."
- "Quiz me on my due cards using spaced repetition."
- "Create a deck from our conversation and start a study session."

## Security

- Treat `DEEPHAUS_API_TOKEN` like a password.
- Revoke tokens from Profile → MCP connections if exposed.
- Prefer local stdio for desktop clients; only expose HTTP when needed.
