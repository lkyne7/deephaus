# Local development

When the user asks to launch or open the local development site, start or reuse
the web development server and open its localhost URL in VS Code's built-in
browser. Always use the browser inside VS Code unless the user explicitly
requests another browser surface.

The VS Code launch configuration `Launch local dev site` runs `pnpm dev:web`
and opens the server's reported localhost URL in VS Code's integrated browser.
