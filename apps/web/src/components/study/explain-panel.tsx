"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CardExplainKind, CardExplainState, CardFieldFix, ExplainThreadMessage } from "@deephaus/shared";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyPopMenu } from "@/components/study/study-chrome";
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
  { label: "Example", message: "Give me one concrete example." },
  { label: "Quiz me", message: "Ask me one quick question to check I understand this." },
  { label: "Compare", message: "Compare this with the idea I'm most likely to mix it up with." },
];
const CHECK_CARD = "Is anything wrong or unclear on this card? If so, suggest a fix.";
const SUGGEST_CARD = "Suggest one new card that would help me remember this.";

async function readError(res: Response): Promise<string> {
  if (res.status === 402) return "You're out of AI credits for now.";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Something went wrong (${res.status}).`;
}

/** Pairs each question with its answer, keeping the message index the API needs. */
function questionRows(thread: ExplainThreadMessage[]) {
  const rows: Array<{ question: string | null; answers: Array<{ message: ExplainThreadMessage; index: number }> }> = [];
  thread.forEach((message, index) => {
    if (message.role === "user") rows.push({ question: message.text, answers: [] });
    else {
      if (rows.length === 0) rows.push({ question: null, answers: [] });
      rows[rows.length - 1].answers.push({ message, index });
    }
  });
  return rows;
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
  /** The question being answered, shown in the list until the saved thread has it. */
  const [asked, setAsked] = useState<string | null>(null);
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

  const threadLength = state?.thread.length ?? 0;
  useEffect(() => {
    if (threadLength === 0 && !asked) return;
    threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [threadLength, asked]);

  async function ask(message: string) {
    const text = message.trim();
    if (!text || phase) return;
    setPhase("asking");
    setAsked(text);
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
      setAsked(null);
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
      <div className="dh-panel__head dh-study__panel-head">
        <span className="dh-pill">{kind === "hint" ? "Hint" : "Explain"}</span>
        <span className="dh-spacer" />
        {explanation ? (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(event) => {
                // Opening the panel puts this under the pointer, so the second half of
                // a double-click on Explain must not spend a credit.
                if (event.detail < 2) void ask(CHECK_CARD);
              }}
              disabled={!!phase}
            >
              Fix card
            </button>
            <StudyPopMenu label="Explanation options">
              {(close) => (
                <>
                  <MenuRow
                    icon="ri-add-line"
                    label="Add a card from this"
                    disabled={!!phase}
                    onClick={() => {
                      close();
                      void ask(SUGGEST_CARD);
                    }}
                  />
                  <MenuRow
                    icon="ri-file-copy-line"
                    label="Copy"
                    onClick={() => {
                      close();
                      copy();
                    }}
                  />
                  <MenuRow
                    icon="ri-refresh-line"
                    label="Write a new one"
                    note="1 credit"
                    disabled={!!phase}
                    onClick={() => {
                      close();
                      void write(true);
                    }}
                  />
                </>
              )}
            </StudyPopMenu>
          </>
        ) : null}
        <button type="button" className="dh-study__icon-btn" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body dh-study__explain-body">
        {busy ? <ExplainSkeleton kind={kind} /> : null}

        {error && !(kind === "explain" && explanation) ? (
          <div className="dh-study__error" role="alert">
            {error}
          </div>
        ) : null}

        {!busy && state?.stale && (explanation || hints.length > 0) ? (
          <div className="dh-note" role="status">
            <i className="ri-information-line" aria-hidden />
            <span>
              This card changed since this was written.{" "}
              <button
                type="button"
                className="dh-study__note-link"
                onClick={() => void write(true)}
                disabled={!!phase}
              >
                Write a new one · 1 credit
              </button>
            </span>
          </div>
        ) : null}

        {!busy && hints.length > 0 ? (
          <>
            <div className="dh-study__intro" aria-live="polite">
              <h2 className="dh-study__panel-title">{hints[hintsShown - 1]}</h2>
              <p className="dh-study__panel-meta">
                Hint {hintsShown} of {hints.length}
              </p>
            </div>
            <div className="dh-study__panel-actions">
              {hintsShown < hints.length ? (
                <button type="button" className="btn btn-primary" onClick={() => setHintsShown((n) => n + 1)}>
                  Another hint
                </button>
              ) : null}
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                I&apos;ve got it
              </button>
            </div>
            <div
              className="dh-study__hint-bar"
              role="img"
              aria-label={`${hintsShown} of ${hints.length} hints used`}
            >
              {hints.map((_, i) => (
                <span key={i} data-used={i < hintsShown ? "" : undefined} />
              ))}
            </div>
            {hintsShown > 1 ? (
              <PanelSection label="Earlier hints">
                <ul className="dh-study__rows">
                  {hints
                    .slice(0, hintsShown - 1)
                    .reverse()
                    .map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                </ul>
              </PanelSection>
            ) : null}
          </>
        ) : null}

        {!busy && explanation ? (
          <>
            <div className="dh-study__intro" data-stale={state?.stale ? "" : undefined}>
              <h2 className="dh-study__panel-title">{explanation.gist}</h2>
              {state?.source?.quote ? (
                <p className="dh-study__panel-meta">From {state.source.title || "your source"}</p>
              ) : null}
            </div>
            {explanation.card_issue && !state?.stale ? (
              <SuggestedFix
                problem={explanation.card_issue.problem}
                fix={explanation.card_issue.fix}
                card={card}
                onApply={() => void apply({ from: "explanation" })}
                onOpenEdit={onOpenEdit ? () => onOpenEdit(explanation.card_issue!.fix) : undefined}
              />
            ) : null}
            {explanation.why.length > 0 ? (
              <PanelSection label="Why it’s true">
                <ul className="dh-study__rows">
                  {explanation.why.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </PanelSection>
            ) : null}
            {state?.source?.quote ? (
              <PanelSection
                label="Source"
                aside={showInSource ? <Link href={showInSource}>Show in source</Link> : null}
              >
                <blockquote className="dh-study__field">{state.source.quote}</blockquote>
              </PanelSection>
            ) : null}
            {explanation.confusable && state?.confusable ? (
              <PanelSection label="Don’t confuse with" aside={<span>In this deck</span>}>
                <div className="dh-study__qa">
                  {state.confusable.type === "cloze" ? (
                    <div className="dh-study__q">
                      <CardContentRenderer content={state.confusable.cloze_text ?? ""} clozeMode="revealed" />
                    </div>
                  ) : (
                    <>
                      <div className="dh-study__q">
                        <CardContentRenderer content={state.confusable.front ?? ""} />
                      </div>
                      <div className="dh-study__a">
                        <CardContentRenderer content={state.confusable.back ?? ""} />
                      </div>
                    </>
                  )}
                  <p className="dh-study__a">{explanation.confusable.note}</p>
                </div>
              </PanelSection>
            ) : null}
            {explanation.hook ? (
              <PanelSection label="Memory hook">
                <p className="dh-study__text">{explanation.hook}</p>
              </PanelSection>
            ) : null}

            {threadLength > 0 || asked ? (
              <PanelSection label="Your questions">
                {questionRows(state?.thread ?? []).map((row, i) => (
                  <div key={i} className="dh-study__qa">
                    {row.question ? <p className="dh-study__q">{row.question}</p> : null}
                    {row.answers.map(({ message, index }) => (
                      <div key={index} className="dh-study__answer-block">
                        <div className="dh-study__a">
                          <CardContentRenderer content={message.text} />
                        </div>
                        {message.suggestion?.kind === "fix" && !dismissed.has(`${index}`) ? (
                          <SuggestedFix
                            fix={message.suggestion.fix}
                            card={card}
                            applied={message.suggestion.applied}
                            onApply={() => void apply({ message_index: index })}
                            onOpenEdit={
                              onOpenEdit
                                ? () => onOpenEdit((message.suggestion as { fix: CardFieldFix }).fix)
                                : undefined
                            }
                            onDismiss={() => setDismissed((d) => new Set(d).add(`${index}`))}
                          />
                        ) : null}
                        {message.suggestion?.kind === "new_card" ? (
                          <section className="dh-study__suggestion" aria-label="New card">
                            <div className="dh-section-label dh-study__label">New card</div>
                            <Field label="Front">
                              <CardContentRenderer content={message.suggestion.front} />
                            </Field>
                            <Field label="Back">
                              <CardContentRenderer content={message.suggestion.back} />
                            </Field>
                            {message.suggestion.added ? (
                              <p className="dh-study__suggestion-done">
                                <i className="ri-check-line" aria-hidden /> Added to this deck
                              </p>
                            ) : (
                              <div className="dh-study__panel-actions">
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => void apply({ message_index: index })}
                                >
                                  Add to deck
                                </button>
                              </div>
                            )}
                          </section>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
                {asked ? (
                  <div className="dh-study__qa" aria-busy="true">
                    <p className="dh-study__q">{asked}</p>
                    <div className="dh-study__lines">
                      <SkeletonBar width="88%" height={12} />
                      <SkeletonBar width="64%" height={12} />
                    </div>
                  </div>
                ) : null}
              </PanelSection>
            ) : null}
            <div className="dh-study__chips">
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
            <div ref={threadEnd} className="dh-study__thread-end" />
          </>
        ) : null}

        {!busy && !hasContent(state, kind) ? (
          <>
            <div className="dh-study__intro">
              <h2 className="dh-study__panel-title">{kind === "hint" ? "No hints yet" : "No explanation yet"}</h2>
              <p className="dh-study__panel-meta">
                {kind === "hint"
                  ? "Get up to 3 hints, one at a time. They never show the answer."
                  : "A short explanation grounded in your source, with a memory hook when one helps."}
              </p>
            </div>
            <div className="dh-study__panel-actions">
              <button type="button" className="btn btn-primary" onClick={() => void write()}>
                {kind === "hint" ? "Get a hint" : "Explain this card"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {!busy && explanation ? (
        <div className="dh-panel__foot dh-study__composer" data-study-keys="ignore">
          {error ? (
            <div className="dh-study__error" role="alert">
              {error}
            </div>
          ) : null}
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
              placeholder={threadLength > 0 ? "Ask a follow-up" : "Ask about this card"}
              maxLength={1000}
              disabled={phase === "asking"}
            />
            <button type="submit" aria-label="Send" disabled={!question.trim() || !!phase}>
              <i className="ri-arrow-up-line" aria-hidden />
            </button>
          </form>
          <div className="dh-study__foot-status">
            <i className={state?.stale ? "ri-time-line" : "ri-check-line"} aria-hidden />
            {state?.stale ? "Older version" : "Saved"}
            <span className="dh-spacer" />
            <span>1 credit a question</span>
          </div>
        </div>
      ) : (
        <div className="dh-panel__foot dh-study__foot">
          {phase === "writing" ? (
            <span role="status">Writing…</span>
          ) : phase === "reading" ? (
            <span role="status">Loading…</span>
          ) : hints.length > 0 ? (
            <>
              <span>Answer stays hidden</span>
              <span className="dh-spacer" />
              <span>Becomes Explain after you reveal</span>
            </>
          ) : (
            <>
              <span>Reopening is free</span>
              <span className="dh-spacer" />
              <span>1 credit to write</span>
            </>
          )}
        </div>
      )}
    </>
  );
}

function PanelSection({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="dh-section-label dh-study__label">
        <h3>{label}</h3>
        {aside ? (
          <>
            <span className="dh-spacer" />
            {aside}
          </>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MenuRow({
  icon,
  label,
  note,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="dh-menu-row" disabled={disabled} onClick={onClick}>
      <i className={icon} aria-hidden />
      {label}
      {note ? (
        <>
          <span className="dh-menu-spacer" />
          <span className="dh-study__menu-note">{note}</span>
        </>
      ) : null}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dh-study__field-group">
      <span className="dh-study__field-label">{label}</span>
      <div className="dh-study__field">{children}</div>
    </div>
  );
}

/** Card text as the card shows it; a cloze keeps its markers, which a fix may move. */
function FieldText({ field, text }: { field: keyof CardFieldFix; text: string }) {
  return field === "cloze_text" ? text : <CardContentRenderer content={text} />;
}

/** The panel's shape while a result loads or is being written. */
function ExplainSkeleton({ kind }: { kind: CardExplainKind }) {
  return (
    <div className="dh-study__explain-loading" aria-busy="true">
      <div className="dh-study__lines">
        <SkeletonBar width="100%" height={20} />
        <SkeletonBar width="62%" height={20} />
        <SkeletonBar width="34%" height={12} />
      </div>
      {kind === "explain" ? (
        <>
          <div className="dh-study__lines">
            <SkeletonBar width="24%" height={12} />
            <SkeletonBar width="96%" height={13} />
            <SkeletonBar width="72%" height={13} />
            <SkeletonBar width="88%" height={13} />
          </div>
          <SkeletonBar width="100%" height={68} radius={12} />
        </>
      ) : (
        <SkeletonBar width="100%" height={40} radius={9} />
      )}
    </div>
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
      <div className="dh-section-label dh-study__label">
        <h3>Suggested fix</h3>
        {onDismiss && !applied ? (
          <>
            <span className="dh-spacer" />
            <button type="button" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        ) : null}
      </div>
      {problem ? <p className="dh-study__text">{problem}</p> : null}
      {fields.map((key) => (
        <Field key={key} label={FIELD_LABELS[key]}>
          {/* Once applied, only the fix is known: the text it replaced isn't stored, and the card now reads as the fix (or as a later one). */}
          {card[key] && !applied ? (
            <del>
              <FieldText field={key} text={card[key]!} />
            </del>
          ) : null}
          <ins>
            <FieldText field={key} text={fix[key]!} />
          </ins>
        </Field>
      ))}
      {applied ? (
        <p className="dh-study__suggestion-done">
          <i className="ri-check-line" aria-hidden /> Applied to the card
        </p>
      ) : (
        <div className="dh-study__panel-actions">
          <button type="button" className="btn btn-primary" onClick={onApply}>
            Apply to card
          </button>
          {onOpenEdit ? (
            <button type="button" className="btn btn-secondary" onClick={onOpenEdit}>
              Open in Edit
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
