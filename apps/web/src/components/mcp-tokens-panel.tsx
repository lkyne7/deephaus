"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ApiTokenSummary = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
};

type CreatedToken = ApiTokenSummary & { token: string };

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function claudeDesktopConfig(apiUrl: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        deephaus: {
          command: "node",
          args: ["path/to/deephaus/apps/mcp-server/dist/stdio.js"],
          env: {
            DEEPHAUS_API_URL: apiUrl,
            DEEPHAUS_API_TOKEN: token,
          },
        },
      },
    },
    null,
    2,
  );
}

export function McpTokensPanel() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://www.deephaus.ai";
    return window.location.origin;
  }, []);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load tokens");
      setTokens(json.tokens ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to create token");
      setCreatedToken(json as CreatedToken);
      setName("");
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to revoke token");
      if (createdToken?.id === id) setCreatedToken(null);
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke token");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyText(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 2000);
  }

  const setupSnippet =
    createdToken != null
      ? claudeDesktopConfig(apiUrl, createdToken.token)
      : claudeDesktopConfig(apiUrl, "dh_your_token_here");

  return (
    <section style={s.card}>
      <div style={s.sectionHead}>
        <div>
          <h2 style={s.sectionTitle}>MCP connections</h2>
          <p style={s.sectionSub}>
            Connect Claude Desktop, ChatGPT, or Cursor to DeepHaus for spaced-repetition study
            inside any conversation. Create a personal access token and add the MCP server to your
            client.
          </p>
        </div>
      </div>

      {error && <p style={s.error}>{error}</p>}

      <form onSubmit={handleCreate} style={s.createRow}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. Claude Desktop)"
          style={s.input}
          maxLength={80}
        />
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>

      {createdToken && (
        <div style={s.secretBox}>
          <p style={s.secretTitle}>Copy your token now — it won&apos;t be shown again.</p>
          <code style={s.secretCode}>{createdToken.token}</code>
          <div style={s.actionsRow}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void copyText("token", createdToken.token)}
            >
              {copied === "token" ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCreatedToken(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={s.setupBlock}>
        <div style={s.setupHead}>
          <h3 style={s.setupTitle}>Claude Desktop config</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void copyText("config", setupSnippet)}
          >
            {copied === "config" ? "Copied" : "Copy config"}
          </button>
        </div>
        <pre style={s.pre}>{setupSnippet}</pre>
        <p style={s.setupHint}>
          Remote HTTP (ChatGPT Connectors): run{" "}
          <code style={s.inlineCode}>pnpm --filter @deephaus/mcp-server start:http</code> and point
          your connector at{" "}
          <code style={s.inlineCode}>{apiUrl.replace(/:\d+$/, ":8787")}/mcp</code> with{" "}
          <code style={s.inlineCode}>Authorization: Bearer dh_...</code>.
        </p>
      </div>

      <div>
        <h3 style={s.setupTitle}>Active tokens</h3>
        {loading ? (
          <p style={s.muted}>Loading…</p>
        ) : tokens.length === 0 ? (
          <p style={s.muted}>No tokens yet.</p>
        ) : (
          <ul style={s.tokenList}>
            {tokens.map((token) => (
              <li key={token.id} style={s.tokenItem}>
                <div>
                  <div style={s.tokenName}>{token.name}</div>
                  <div style={s.tokenMeta}>
                    <span>{token.token_prefix}…</span>
                    <span>Last used {formatRelative(token.last_used_at)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={revokingId === token.id}
                  onClick={() => void handleRevoke(token.id)}
                >
                  {revokingId === token.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  sectionTitle: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
  },
  sectionSub: {
    font: "400 14px/22px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 560,
  },
  createRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  input: {
    flex: 1,
    minWidth: 220,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    color: "var(--fg-primary)",
    font: "400 14px/20px var(--font-sans)",
  },
  secretBox: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--brand-300)",
    background: "var(--brand-50)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  secretTitle: {
    margin: 0,
    font: "500 13px/18px var(--font-sans)",
    color: "var(--brand-800)",
  },
  secretCode: {
    display: "block",
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    font: "500 13px/20px var(--font-mono)",
    wordBreak: "break-all",
  },
  actionsRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  setupBlock: { display: "flex", flexDirection: "column", gap: 8 },
  setupHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  setupTitle: {
    margin: 0,
    font: "600 15px/22px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  pre: {
    margin: 0,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface-2)",
    overflowX: "auto",
    font: "500 12px/18px var(--font-mono)",
    color: "var(--fg-secondary)",
  },
  setupHint: {
    margin: 0,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  inlineCode: {
    font: "500 12px/18px var(--font-mono)",
    color: "var(--fg-secondary)",
  },
  tokenList: {
    listStyle: "none",
    margin: "8px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  tokenItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
  },
  tokenName: {
    font: "600 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  tokenMeta: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 2,
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  muted: {
    margin: "8px 0 0",
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  error: {
    margin: 0,
    font: "500 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
