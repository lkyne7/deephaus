"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LOCAL_AI_ENGINES, type LocalAiEngine, type LocalAiStatus } from "@deephaus/shared";
import { useDesktopBridge } from "@/components/desktop/use-desktop-bridge";
import { ConnectedPill, ConnectionRow } from "@/components/settings/connection-row";
import { useLocalEngine } from "@/lib/local-ai/preference";

const ENGINES: Record<
  LocalAiEngine,
  { name: string; account: string; icon: string; install: string; signIn: string }
> = {
  claude: {
    name: "Claude Code",
    account: "Claude",
    icon: "ri-terminal-box-line",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    signIn: "claude auth login",
  },
  codex: {
    name: "Codex",
    account: "ChatGPT",
    icon: "ri-terminal-box-line",
    install: "npm install -g @openai/codex",
    signIn: "codex login",
  },
};

function planLabel(plan: string | undefined): string {
  if (!plan) return "Signed in";
  return `Signed in · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

function detailFor(status: LocalAiStatus) {
  const { install, signIn } = ENGINES[status.engine];
  if (status.signedIn) return planLabel(status.plan);
  return (
    <>
      {status.installed ? "Sign in from a terminal: " : "Install it from a terminal: "}
      <code>{status.installed ? signIn : install}</code>
    </>
  );
}

/** Run card generation on a Claude or ChatGPT plan through the desktop app. */
export function LocalAiPanel() {
  const ai = useDesktopBridge()?.ai;
  const [engine, setEngine] = useLocalEngine();
  const [statuses, setStatuses] = useState<LocalAiStatus[] | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    if (!ai) return;
    setChecking(true);
    try {
      setStatuses(await ai.status());
    } catch {
      setStatuses([]);
    } finally {
      setChecking(false);
    }
  }, [ai]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = statuses?.find((status) => status.engine === engine);
  // Falling back quietly would spend credits the user chose not to spend.
  const unavailable = engine && selected && !selected.signedIn;

  return (
    <section className="dhs-sec">
      <h2>AI accounts</h2>
      <p className="dhs-muted">
        Generate cards on your own Claude or ChatGPT plan instead of DeepHaus credits. Your sign-in
        stays in the provider&apos;s app on this computer, and DeepHaus never sees it.
      </p>

      {!ai ? (
        <ConnectionRow
          icon="ri-computer-line"
          name="Available in the desktop app"
          detail="Your plan runs through Claude Code or Codex on your computer, so this needs the latest DeepHaus desktop app."
        >
          <Link className="btn btn-secondary btn-sm" href="/download">
            Get the app
          </Link>
        </ConnectionRow>
      ) : (
        <>
          {(statuses ?? []).map((status) => (
            <ConnectionRow
              key={status.engine}
              icon={ENGINES[status.engine].icon}
              name={ENGINES[status.engine].name}
              detail={detailFor(status)}
            >
              {status.signedIn ? <ConnectedPill /> : null}
            </ConnectionRow>
          ))}

          <div className="dhs-row">
            <div className="dhs-row__main">
              <label className="dhs-row__title" htmlFor="generation-engine">
                Generate cards with
              </label>
              <div className="dhs-muted">
                Text you generate from is sent to the provider under your account and its terms.
                Video transcription and other AI features still use credits.
              </div>
            </div>
            <select
              id="generation-engine"
              className="input dhs-select dhs-select--engine"
              value={engine ?? ""}
              onChange={(event) => setEngine((event.target.value || null) as LocalAiEngine | null)}
            >
              <option value="">DeepHaus credits</option>
              {LOCAL_AI_ENGINES.filter(
                (id) => id === engine || statuses?.some((status) => status.engine === id && status.signedIn),
              ).map((id) => (
                <option key={id} value={id}>
                  My {ENGINES[id].account} plan
                </option>
              ))}
            </select>
          </div>

          {unavailable ? (
            <p className="dhs-muted" role="alert">
              {ENGINES[engine].name} isn&apos;t signed in, so generation will fail until you sign in
              or switch back to DeepHaus credits.
            </p>
          ) : null}

          <button className="btn btn-ghost btn-sm" type="button" disabled={checking} onClick={() => void refresh()}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </>
      )}
    </section>
  );
}
