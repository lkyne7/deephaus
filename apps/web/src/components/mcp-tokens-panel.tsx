"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiTokenSummary = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
  kind: "pat" | "oauth";
  client_id: string | null;
};

type CreatedToken = ApiTokenSummary & { token: string };

type McpAccessState = "loading" | "allowed" | "locked";

const EXPIRY_CHOICES = [
  { label: "Never expires", value: "" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "1 year", value: "365" },
];

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

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() <= Date.now()) return "Expired";
  return `Expires ${date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
}

function hostedUrl(origin: string) {
  return `${origin}/api/mcp`;
}

function cursorDeeplink(origin: string) {
  const config = btoa(JSON.stringify({ url: hostedUrl(origin) }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=deephaus&config=${encodeURIComponent(config)}`;
}

function cursorConfig(origin: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        deephaus: {
          url: hostedUrl(origin),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

function claudeDesktopConfig(origin: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        deephaus: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            hostedUrl(origin),
            "--header",
            `Authorization: Bearer ${token}`,
          ],
        },
      },
    },
    null,
    2,
  );
}

export function McpTokensPanel() {
  const [access, setAccess] = useState<McpAccessState>("loading");
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://www.deephaus.ai";
    return window.location.origin;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/status", { credentials: "include" });
        const json = await res.json();
        if (cancelled) return;
        setAccess(json?.features?.mcpAccess ? "allowed" : "locked");
      } catch {
        // If billing can't be loaded, show the panel; the API still enforces.
        if (!cancelled) setAccess("allowed");
      }
    })();
    return () => {
      cancelled = true;
    };
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
    if (access === "allowed") void loadTokens();
  }, [access, loadTokens]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(expiryDays ? { expires_in_days: Number(expiryDays) } : {}),
        }),
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

  const connectedApps = tokens.filter((t) => t.kind === "oauth");
  const pats = tokens.filter((t) => t.kind !== "oauth");
  const tokenPlaceholder = createdToken?.token ?? "dh_your_token_here";

  if (access === "locked") {
    return (
      <section style={s.card}>
        <div style={s.sectionHead}>
          <div>
            <h2 style={s.sectionTitle}>MCP connections</h2>
            <p style={s.sectionSub}>
              Connect Claude, ChatGPT, or Cursor to DeepHaus and study your decks from any
              conversation.
            </p>
          </div>
        </div>
        <div style={s.upgradeBox}>
          <i className="ri-lock-2-line" aria-hidden style={s.upgradeIcon} />
          <div style={s.upgradeCopy}>
            <strong style={s.upgradeTitle}>MCP access is a Pro feature</strong>
            <p style={s.upgradeText}>
              Upgrade to Pro to connect AI assistants to your flashcards.
            </p>
          </div>
          <Link href="/pricing" className="btn btn-primary btn-sm">
            Upgrade to Pro
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section style={s.card}>
      <div style={s.sectionHead}>
        <div>
          <h2 style={s.sectionTitle}>MCP connections</h2>
          <p style={s.sectionSub}>
            Connect Claude, ChatGPT, or Cursor to DeepHaus and study your decks from any
            conversation. Add the server URL to your client and sign in when prompted — no tokens
            to copy.
          </p>
        </div>
      </div>

      {error && <p style={s.error}>{error}</p>}

      <div style={s.setupBlock}>
        <div style={s.setupHead}>
          <h3 style={s.setupTitle}>Server URL</h3>
          <div style={s.actionsRow}>
            <a className="btn btn-secondary btn-sm" href={cursorDeeplink(apiUrl)}>
              <i className="ri-download-line" aria-hidden /> Add to Cursor
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText("url", hostedUrl(apiUrl))}
            >
              {copied === "url" ? "Copied" : "Copy URL"}
            </button>
          </div>
        </div>
        <pre style={s.pre}>{hostedUrl(apiUrl)}</pre>
        <p style={s.setupHint}>
          In ChatGPT or Claude, add DeepHaus as a custom connector with this URL. In Cursor, use the
          button above or paste the URL into MCP settings. Your client opens a DeepHaus sign-in page
          to authorize access.
        </p>
      </div>

      <div>
        <h3 style={s.setupTitle}>Connected apps</h3>
        {loading ? (
          <p style={s.muted}>Loading…</p>
        ) : connectedApps.length === 0 ? (
          <p style={s.muted}>No apps connected yet. Apps appear here after you approve them.</p>
        ) : (
          <ul style={s.tokenList}>
            {connectedApps.map((token) => (
              <li key={token.id} style={s.tokenItem}>
                <div>
                  <div style={s.tokenName}>{token.name}</div>
                  <div style={s.tokenMeta}>
                    <span>Last used {formatRelative(token.last_used_at)}</span>
                    <span>Scopes: {token.scopes.join(", ")}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={revokingId === token.id}
                  onClick={() => void handleRevoke(token.id)}
                >
                  {revokingId === token.id ? "Disconnecting…" : "Disconnect"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details style={s.advanced}>
        <summary style={s.advancedSummary}>Personal access tokens (advanced)</summary>
        <div style={s.advancedBody}>
          <p style={s.setupHint}>
            For the stdio server, scripts, or clients without OAuth support, create a long-lived
            token and pass it as an <code style={s.inlineCode}>Authorization: Bearer</code> header.
          </p>

          <form onSubmit={handleCreate} style={s.createRow}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name (e.g. stdio server)"
              style={s.input}
              maxLength={80}
            />
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              style={s.select}
              aria-label="Token expiry"
            >
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
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

          <div style={s.setupHead}>
            <h4 style={s.setupSubtitle}>Cursor with a manual token (.cursor/mcp.json)</h4>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText("cursor", cursorConfig(apiUrl, tokenPlaceholder))}
            >
              {copied === "cursor" ? "Copied" : "Copy config"}
            </button>
          </div>
          <pre style={s.pre}>{cursorConfig(apiUrl, tokenPlaceholder)}</pre>
          <div style={s.setupHead}>
            <h4 style={s.setupSubtitle}>Claude Desktop (claude_desktop_config.json)</h4>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText("claude", claudeDesktopConfig(apiUrl, tokenPlaceholder))}
            >
              {copied === "claude" ? "Copied" : "Copy config"}
            </button>
          </div>
          <pre style={s.pre}>{claudeDesktopConfig(apiUrl, tokenPlaceholder)}</pre>

          <div>
            <h4 style={s.setupSubtitle}>Active tokens</h4>
            {loading ? (
              <p style={s.muted}>Loading…</p>
            ) : pats.length === 0 ? (
              <p style={s.muted}>No tokens yet.</p>
            ) : (
              <ul style={s.tokenList}>
                {pats.map((token) => (
                  <li key={token.id} style={s.tokenItem}>
                    <div>
                      <div style={s.tokenName}>{token.name}</div>
                      <div style={s.tokenMeta}>
                        <span>{token.token_prefix}…</span>
                        <span>Last used {formatRelative(token.last_used_at)}</span>
                        {formatExpiry(token.expires_at) && <span>{formatExpiry(token.expires_at)}</span>}
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
        </div>
      </details>
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
  upgradeBox: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface-2)",
  },
  upgradeIcon: {
    fontSize: 22,
    color: "var(--fg-tertiary)",
  },
  upgradeCopy: { flex: 1, minWidth: 0 },
  upgradeTitle: {
    display: "block",
    font: "600 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  upgradeText: {
    margin: "2px 0 0",
    font: "400 13px/19px var(--font-sans)",
    color: "var(--fg-tertiary)",
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
  select: {
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
  actionsRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
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
  setupSubtitle: {
    margin: 0,
    font: "600 13px/20px var(--font-sans)",
    color: "var(--fg-secondary)",
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
  advanced: {
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: "12px 16px",
  },
  advancedSummary: {
    cursor: "pointer",
    font: "600 13px/20px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  advancedBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 14,
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
