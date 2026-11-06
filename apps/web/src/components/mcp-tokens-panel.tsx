"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

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

function scopeSummary(scopes: string[]): string {
  const study = scopes.includes("study");
  const write = scopes.includes("write");
  if (study && write) return "Study and write access";
  if (study) return "Study access";
  if (write) return "Write access";
  return scopes.join(", ");
}

function formatConnected(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
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

const subscribeToNothing = () => () => undefined;

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

  const apiUrl = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "https://www.deephaus.ai",
  );

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

  const intro = "Let Claude, Cursor and other assistants read and study your decks.";

  if (access === "locked") {
    return (
      <section className="dhs-sec">
        <h2>MCP</h2>
        <p className="dhs-lede">{intro}</p>
        <div className="dh-note dhs-note">
          <i className="ri-lock-2-line" aria-hidden />
          <div>
            <strong>MCP access is a Pro feature</strong>
            <p>Upgrade to Pro to connect AI assistants to your flashcards.</p>
          </div>
          <span className="dh-spacer" />
          <Link href="/pricing" className="btn btn-primary btn-sm">
            Upgrade to Pro
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="dhs-sec">
      <h2>MCP</h2>
      <p className="dhs-lede">{intro}</p>

      {error ? <p className="dhs-error">{error}</p> : null}

      <div className="dhs-url">
        <code>{hostedUrl(apiUrl)}</code>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void copyText("url", hostedUrl(apiUrl))}
        >
          <i className={copied === "url" ? "ri-check-line" : "ri-file-copy-line"} aria-hidden />
          {copied === "url" ? "Copied" : "Copy URL"}
        </button>
      </div>
      <a className="btn btn-secondary btn-sm" href={cursorDeeplink(apiUrl)}>
        Add to Cursor
      </a>
      <p className="dhs-help">
        In ChatGPT or Claude, add DeepHaus as a custom connector with this URL. In Cursor, use the
        button above or paste the URL into MCP settings. Your client opens a DeepHaus sign-in page to
        authorize access, so there are no tokens to copy.
      </p>

      <div className="dh-section-label dhs-sublabel">Connected apps</div>
      {loading ? (
        <p className="dhs-muted">Loading…</p>
      ) : connectedApps.length === 0 ? (
        <p className="dhs-muted">No apps connected yet. Apps appear here after you approve them.</p>
      ) : (
        connectedApps.map((token) => (
          <div key={token.id} className="dhs-row">
            <span className="dhs-logo" aria-hidden>
              <i className="ri-sparkling-2-line" />
            </span>
            <div className="dhs-row__main">
              <div className="dhs-row__title">{token.name}</div>
              <div className="dhs-muted">
                {scopeSummary(token.scopes)} · connected {formatConnected(token.created_at)} · last used{" "}
                {formatRelative(token.last_used_at).toLowerCase()}
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
          </div>
        ))
      )}

      <details className="dhs-disclosure">
        <summary>
          Personal access tokens
          <i className="ri-arrow-down-s-line" aria-hidden />
        </summary>
        <div className="dhs-disclosure__body">
          <p className="dhs-help">
            For the stdio server, scripts or clients without OAuth, create a long-lived token and pass
            it as an <code>Authorization: Bearer</code> header.
          </p>

          <form onSubmit={handleCreate} className="dhs-inline">
            <input
              type="text"
              className="input dhs-inline__grow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name (e.g. stdio server)"
              aria-label="Token name"
              maxLength={80}
            />
            <select
              className="input dhs-select dhs-select--wide"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
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

          {createdToken ? (
            <div className="dhs-secret">
              <p>Copy your token now. It won&apos;t be shown again.</p>
              <code className="ph-no-capture">{createdToken.token}</code>
              <div className="dhs-inline">
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
          ) : null}

          <div className="dhs-config-head">
            <h3>Cursor with a manual token (.cursor/mcp.json)</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText("cursor", cursorConfig(apiUrl, tokenPlaceholder))}
            >
              {copied === "cursor" ? "Copied" : "Copy config"}
            </button>
          </div>
          <pre className="ph-no-capture dhs-pre">{cursorConfig(apiUrl, tokenPlaceholder)}</pre>
          <div className="dhs-config-head">
            <h3>Claude Desktop (claude_desktop_config.json)</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText("claude", claudeDesktopConfig(apiUrl, tokenPlaceholder))}
            >
              {copied === "claude" ? "Copied" : "Copy config"}
            </button>
          </div>
          <pre className="ph-no-capture dhs-pre">{claudeDesktopConfig(apiUrl, tokenPlaceholder)}</pre>

          <div className="dhs-config-head">
            <h3>Active tokens</h3>
          </div>
          {loading ? (
            <p className="dhs-muted">Loading…</p>
          ) : pats.length === 0 ? (
            <p className="dhs-muted">No tokens yet.</p>
          ) : (
            pats.map((token) => (
              <div key={token.id} className="dhs-row">
                <div className="dhs-row__main">
                  <div className="dhs-row__title">{token.name}</div>
                  <div className="dhs-muted">
                    {token.token_prefix}… · last used {formatRelative(token.last_used_at).toLowerCase()}
                    {formatExpiry(token.expires_at) ? ` · ${formatExpiry(token.expires_at)}` : ""}
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
              </div>
            ))
          )}
        </div>
      </details>
    </section>
  );
}
