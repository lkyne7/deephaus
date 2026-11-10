"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardExplainKind, CardExplainState, CardFieldFix } from "@deephaus/shared";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { apiFetch } from "@/lib/api/fetch";

/**
 * The study panel's Hint (before the answer is shown) and Explain (after).
 * Saved results reopen free; writing a new one costs 1 credit, and the panel
 * only writes one when the student asked for it.
 */

export type ExplainPanelCard = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  cloze_ord?: number | null;
};

export type ExplainCardFix = { id: string } & CardFieldFix;

const FOLLOW_UPS = [
  { label: "Simpler", message: "Explain it more simply." },
  { label: "Give an example", message: "Give me one concrete example." },
  { label: "Quiz me on it", message: "Ask me one quick question to check I understand this." },
  { label: "Compare with…", message: "Compare this with the idea I'm most likely to mix it up with." },
];
const CHECK_CARD = "Is anything wrong or unclear on this card? If so, suggest a fix.";
const SUGGEST_CARD = "Suggest one new card that would help me remember this.";

async function readError(res: Response): Promise<string> {
  if (res.status === 402) return "You're out of AI credits for now.";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Something went wrong (${res.status}).`;
}

function hasContent(state: CardExplainState | null, kind: CardExplainKind): boolean {
  if (!state) return false;
  return kind === "explain" ? !!state.explanation : state.hints.length > 0;
}

export function ExplainPanel({
  card,
  revealed,
  requestedKind,
  deckId,
  onClose,
  onCardFixed,
  onOpenEdit,
}: {
  card: ExplainPanelCard;
  revealed: boolean;
  /** Which one the student opened the panel for; only that one is written automatically. */
  requestedKind: CardExplainKind;
  deckId?: string | null;
  onClose: () => void;
  onCardFixed?: (fix: ExplainCardFix) => void;
  onOpenEdit?: (fix: CardFieldFix) => void;
}) {
  const kind: CardExplainKind = revealed ? "explain" : "hint";
  const clozeOrd = card.cloze_ord ?? null;
  const [state, setState] = useState<CardExplainState | null>(null);
  const [phase, setPhase] = useState<"reading" | "writing" | "asking" | null>("reading");
  const [error, setError] = useState<string | null>(null);
  const [hintsShown, setHintsShown] = useState(1);
  const [question, setQuestion] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const autoKind = useRef<CardExplainKind | null>(requestedKind);
  const threadEnd = useRef<HTMLDivElement>(null);

  const write = useCallback(
    async (rewrite = false) => {
      setPhase("writing");
      setError(null);
      try {
        const res = await apiFetch(`/api/cards/${card.id}/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ kind, cloze_ord: clozeOrd, rewrite }),
        });
        if (!res.ok) throw new Error(await readError(res));
        setState((await res.json()) as CardExplainState);
        setHintsShown(1);
      } catch (err) {
        setError(!navigator.onLine ? "Writing a new one needs a connection." : (err as Error).message);
      } finally {
        setPhase(null);
      }
    },
    [card.id, clozeOrd, kind],
  );

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    setPhase("reading");
    void (async () => {
      try {
        const query = `kind=${kind}${clozeOrd ? `&cloze_ord=${clozeOrd}` : ""}`;
        const res = await apiFetch(`/api/cards/${card.id}/explain?${query}`);
        const saved = res.ok ? ((await res.json()) as CardExplainState) : null;
        if (cancelled) return;
        setState(saved);
        setPhase(null);
        if (!hasContent(saved, kind) && autoKind.current === kind) {
          autoKind.current = null;
          void write();
        }
      } catch {
        if (!cancelled) setPhase(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `write` changes with kind; re-reading is keyed on the card and kind only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, kind, clozeOrd]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state?.thread.length]);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || phase) return;
    setPhase("asking");
    setError(null);
    try {
      const res = await apiFetch(`/api/cards/${card.id}/explain/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setState((await res.json()) as CardExplainState);
      setQuestion("");
    } catch (err) {
      setError(!navigator.onLine ? "Questions need a connection." : (err as Error).message);
    } finally {
      setPhase(null);
    }
  }

  async function apply(target: { from: "explanation" } | { message_index: number }) {
    setError(null);
    try {
      const res = await apiFetch(`/api/cards/${card.id}/explain/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as {
        state: CardExplainState;
        card?: ExplainCardFix;
      };
      setState(body.state);
      if (body.card) onCardFixed?.(body.card);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function copy() {
    const e = state?.explanation;
    if (!e) return;
    const text = [e.gist, ...e.why.map((line) => `- ${line}`), e.hook ? `Memory hook: ${e.hook}` : ""]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard?.writeText(text);
  }

  const explanation = kind === "explain" ? state?.explanation : null;
  const hints = kind === "hint" ? (state?.hints ?? []) : [];
  const busy = phase === "reading" || phase === "writing";
  const showInSource =
    deckId && state?.source?.id && state.source.quote
      ? `/create?deck=${deckId}&source=${state.source.id}&card=${card.id}`
      : null;

  return (
    <>
      <div className="dh-panel__head">
        <i
          className={`${kind === "hint" ? "ri-lightbulb-line" : "ri-sparkling-2-line"} dh-study__panel-icon`}
          aria-hidden
        />
        <span className="dh-study__panel-title">{kind === "hint" ? "Hint" : "Explain"}</span>
        {kind === "hint" ? (
          <span className="dh-pill dh-pill--outline">Answer stays hidden</span>
        ) : explanation && !state?.stale ? (
          <span className="dh-pill dh-pill--accent">
            <i className="ri-check-line" aria-hidden />
            Saved
          </span>
        ) : null}
        <span className="dh-spacer" />
        {explanation ? (
          <button
            type="button"
            className="dh-study__icon-btn"
            onClick={() => void write(true)}
            disabled={!!phase}
            aria-label="Write a new explanation (1 credit)"
            title="Write a new explanation (1 credit)"
          >
            <i className="ri-refresh-line" aria-hidden />
          </button>
        ) : null}
        <button type="button" className="dh-study__icon-btn" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body dh-study__explain-body">
        {busy ? (
          <div className="dh-study__explain-loading" aria-busy="true">
            <SkeletonBar width="100%" height={14} />
            <SkeletonBar width="92%" height={14} />
            <SkeletonBar width="78%" height={14} />
            <SkeletonBar width="85%" height={14} />
          </div>
        ) : null}

        {!busy && state?.stale && (explanation || hints.length > 0) ? (
          <div className="dh-study__explain-stale" role="status">
            <span>This card changed since this was written.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void write(true)}>
              Write a new one · 1 credit
            </button>
          </div>
        ) : null}

        {!busy && kind === "hint" && hints.length > 0 ? (
          <ol className="dh-study__hints">
            {hints.slice(0, hintsShown).map((hint, i) => (
              <li key={i}>
                <span className="dh-study__hint-num" aria-hidden>
                  {i + 1}
                </span>
                <p>{hint}</p>
              </li>
            ))}
            {hintsShown < hints.length ? (
              <li className="dh-study__hint-more">
                <span className="dh-study__hint-num" aria-hidden>
                  {hintsShown + 1}
                </span>
                <p>
                  {hints.length - hintsShown === 1
                    ? "One more hint left before the answer."
                    : `${hints.length - hintsShown} more hints left.`}
                </p>
              </li>
            ) : null}
          </ol>
        ) : null}
        {!busy && kind === "hint" && hints.length > 0 ? (
          <div className="dh-study__explain-chips">
            {hintsShown < hints.length ? (
              <button type="button" className="dh-study__chip dh-study__chip--strong" onClick={() => setHintsShown((n) => n + 1)}>
                <i className="ri-add-line" aria-hidden />
                Another hint
              </button>
            ) : null}
            <button type="button" className="dh-study__chip" onClick={onClose}>
              I&apos;ve got it
            </button>
          </div>
        ) : null}

        {!busy && explanation ? (
          <>
            <p className="dh-study__explain-gist">{explanation.gist}</p>
            {explanation.why.length > 0 ? (
              <section className="dh-study__explain-section">
                <h3>Why it&apos;s true</h3>
                <ul>
                  {explanation.why.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {state?.source?.quote ? (
              <section className="dh-study__explain-section">
                <h3>From your source</h3>
                <figure className="dh-study__explain-quote">
                  <blockquote>{state.source.quote}</blockquote>
                  <figcaption>
                    <i className="ri-book-2-line" aria-hidden />
                    <span>{state.source.title || "Your source"}</span>
                    {showInSource ? (
                      <Link href={showInSource}>
                        Show in source <i className="ri-arrow-right-up-line" aria-hidden />
                      </Link>
                    ) : null}
                  </figcaption>
                </figure>
              </section>
            ) : null}
            {explanation.confusable && state?.confusable ? (
              <section className="dh-study__explain-section">
                <h3>Don&apos;t confuse with</h3>
                <div className="dh-study__explain-confusable">
                  <div>
                    {state.confusable.type === "cloze" ? (
                      <CardContentRenderer content={state.confusable.cloze_text ?? ""} clozeMode="revealed" />
                    ) : (
                      <>
                        <div className="dh-study__explain-confusable-q">
                          <CardContentRenderer content={state.confusable.front ?? ""} />
                        </div>
                        <CardContentRenderer content={state.confusable.back ?? ""} />
                      </>
                    )}
                    <p>{explanation.confusable.note}</p>
                  </div>
                  <span className="dh-pill">In this deck</span>
                </div>
              </section>
            ) : null}
            {explanation.hook ? (
              <section className="dh-study__explain-section">
                <h3>Memory hook</h3>
                <p>{explanation.hook}</p>
              </section>
            ) : null}
            {explanation.card_issue && !state?.stale ? (
              <SuggestedFix
                problem={explanation.card_issue.problem}
                fix={explanation.card_issue.fix}
                card={card}
                onApply={() => void apply({ from: "explanation" })}
                onOpenEdit={onOpenEdit ? () => onOpenEdit(explanation.card_issue!.fix) : undefined}
              />
            ) : null}
            <div className="dh-study__explain-actions">
              <button type="button" onClick={() => void ask(CHECK_CARD)} disabled={!!phase}>
                <i className="ri-pencil-line" aria-hidden />
                Fix card
              </button>
              <button type="button" onClick={() => void ask(SUGGEST_CARD)} disabled={!!phase}>
                <i className="ri-add-line" aria-hidden />
                Add card
              </button>
              <button type="button" onClick={copy}>
                <i className="ri-file-copy-line" aria-hidden />
                Copy
              </button>
            </div>

            {state && state.thread.length > 0 ? (
              <div className="dh-study__thread">
                {state.thread.map((message, i) =>
                  message.role === "user" ? (
                    <div key={i} className="dh-study__bubble">
                      {message.text}
                    </div>
                  ) : (
                    <div key={i} className="dh-study__reply">
                      <CardContentRenderer content={message.text} />
                      {message.suggestion?.kind === "fix" && !dismissed.has(`${i}`) ? (
                        <SuggestedFix
                          fix={message.suggestion.fix}
                          card={card}
                          applied={message.suggestion.applied}
                          onApply={() => void apply({ message_index: i })}
                          onOpenEdit={onOpenEdit ? () => onOpenEdit((message.suggestion as { fix: CardFieldFix }).fix) : undefined}
                          onDismiss={() => setDismissed((d) => new Set(d).add(`${i}`))}
                        />
                      ) : null}
                      {message.suggestion?.kind === "new_card" ? (
                        <section className="dh-study__suggestion" aria-label="New card">
                          <header>
                            <i className="ri-add-line" aria-hidden />
                            New card from this answer
                          </header>
                          <dl>
                            <dt>Front</dt>
                            <dd>{message.suggestion.front}</dd>
                            <dt>Back</dt>
                            <dd>{message.suggestion.back}</dd>
                          </dl>
                          {message.suggestion.added ? (
                            <p className="dh-study__suggestion-done">
                              <i className="ri-check-line" aria-hidden /> Added to this deck
                            </p>
                          ) : (
                            <div className="dh-study__suggestion-actions">
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => void apply({ message_index: i })}>
                                Add to deck
                              </button>
                            </div>
                          )}
                        </section>
                      ) : null}
                    </div>
                  ),
                )}
                {phase === "asking" ? (
                  <div className="dh-study__explain-loading" aria-busy="true">
                    <SkeletonBar width="88%" height={14} />
                    <SkeletonBar width="64%" height={14} />
                  </div>
                ) : null}
                <div ref={threadEnd} />
              </div>
            ) : phase === "asking" ? (
              <div className="dh-study__explain-loading" aria-busy="true">
                <SkeletonBar width="88%" height={14} />
                <SkeletonBar width="64%" height={14} />
              </div>
            ) : null}
          </>
        ) : null}

        {!busy && !hasContent(state, kind) && !error ? (
          <div className="dh-study__explain-empty">
            <p>
              {kind === "hint"
                ? "Get up to 3 hints, one at a time. They never show the answer."
                : "A short explanation grounded in your source, with a memory hook when one helps."}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void write()}>
              {kind === "hint" ? "Get a hint" : "Explain this card"} · 1 credit
            </button>
          </div>
        ) : null}

        {error && !(kind === "explain" && explanation) ? <div className="dh-study__error">{error}</div> : null}
      </div>

      {kind === "explain" && explanation ? (
        <div className="dh-study__composer" data-study-keys="ignore">
          {error ? (
            <div className="dh-study__error dh-study__composer-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="dh-study__explain-chips">
            {FOLLOW_UPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="dh-study__chip"
                onClick={() => void ask(chip.message)}
                disabled={!!phase}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <form
            className="dh-study__ask"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor={`ask-${card.id}`} className="dh-sr-only">
              Ask about this card
            </label>
            <input
              id={`ask-${card.id}`}
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={state && state.thread.length > 0 ? "Ask a follow-up" : "Ask about this card"}
              maxLength={1000}
              disabled={phase === "asking"}
            />
            <button type="submit" aria-label="Send" disabled={!question.trim() || !!phase}>
              <i className="ri-arrow-up-line" aria-hidden />
            </button>
          </form>
          <p className="dh-study__composer-note">Reopening is free. Each question uses 1 credit.</p>
        </div>
      ) : kind === "hint" ? (
        <p className="dh-study__composer-note dh-study__composer-note--foot">
          <i className="ri-sparkling-2-line" aria-hidden />
          Hints never show the answer. This becomes Explain once you reveal.
        </p>
      ) : null}
    </>
  );
}

const FIELD_LABELS: Record<keyof CardFieldFix, string> = {
  front: "Front",
  back: "Back",
  cloze_text: "Text",
  extra: "Extra",
};

function SuggestedFix({
  problem,
  fix,
  card,
  applied,
  onApply,
  onOpenEdit,
  onDismiss,
}: {
  problem?: string;
  fix: CardFieldFix;
  card: ExplainPanelCard;
  applied?: boolean;
  onApply: () => void;
  onOpenEdit?: () => void;
  onDismiss?: () => void;
}) {
  const fields = (Object.keys(fix) as Array<keyof CardFieldFix>).filter((key) => fix[key] != null);
  return (
    <section className="dh-study__suggestion" aria-label="Suggested fix">
      <header>
        <i className="ri-pencil-line" aria-hidden />
        Suggested fix to this card
      </header>
      {problem ? <p className="dh-study__suggestion-why">{problem}</p> : null}
      <dl>
        {fields.map((key) => (
          <div key={key} className="dh-study__diff">
            <dt>{FIELD_LABELS[key]}</dt>
            <dd>
              {card[key] ? <del>{card[key]}</del> : null}
              <ins>{fix[key]}</ins>
            </dd>
          </div>
        ))}
      </dl>
      {applied ? (
        <p className="dh-study__suggestion-done">
          <i className="ri-check-line" aria-hidden /> Applied to the card
        </p>
      ) : (
        <div className="dh-study__suggestion-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onApply}>
            Apply
          </button>
          {onOpenEdit ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenEdit}>
              Open in Edit
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
