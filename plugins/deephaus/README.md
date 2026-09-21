# DeepHaus plugin

Create flashcards from conversations and review your decks with spaced repetition.
Requires a **DeepHaus Pro** account. Connect through OAuth; no API key or local
server is needed.

MCP URL: `https://www.deephaus.ai/api/mcp`

This repository contains the plugin package. Marketplace listings are pending.

## Package formats

- `plugin.json` + `mcp.json`: portable Agent Plugins package for compatible hosts,
  including current ChatGPT/Codex and Cursor. The transport is `streamable-http`.
- `.claude-plugin/plugin.json` + `.mcp.json`: Claude plugin compatibility package.
  Claude calls the same transport `http`.
- `skills/`: shared study and card-creation workflows.

Keep the endpoint and version aligned across both manifests. Copy only this folder
when preparing a distributable; the application repository is not the plugin.
The plugin files are licensed under MIT, copyright Dekki Inc. This license does
not grant access to the hosted service or rights to DeepHaus trademarks.
Support: info@dekki.ai.

## Connect directly

**ChatGPT:** Enable Developer mode in Settings → Security and login, then add the
MCP URL from the Plugins page. Select OAuth and complete DeepHaus sign-in. For
public distribution, submit the endpoint through OpenAI's **With MCP** flow.
Uploading a local package alone does not publish a ChatGPT plugin.

**Claude:** In Customize → Connectors, select **Add custom connector**, enter
DeepHaus and the MCP URL, then connect and authorize. This remote connection
does not require `mcp-remote` or Node.js. Organization policy may require an admin.

**Claude Code:** Clone this repository and test from its root:

```sh
claude plugin validate .
claude --plugin-dir .
```

Use `/mcp` to authenticate the DeepHaus connection.

**Cursor:** Use **Add to Cursor** in DeepHaus's MCP connections panel, or add:

```json
{
  "mcpServers": {
    "deephaus": { "url": "https://www.deephaus.ai/api/mcp" }
  }
}
```

Complete OAuth when prompted. This direct configuration works independently of
the marketplace submission.

## Try it

- “Create flashcards from the explanation above and save them to DeepHaus.”
- “Quiz me on my due DeepHaus cards, one question at a time.”
- “Find my cards about cellular respiration.”
- “How many cards do I have due today?”

Manage or revoke access in DeepHaus → Profile → MCP connections.

Release materials and remaining checks live in `docs/mcp-distribution.md` in the
application repository.
