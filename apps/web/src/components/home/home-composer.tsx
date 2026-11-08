"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardSettingsMenu, cardSettingsSummary } from "@/components/create/card-settings-menu";
import { markAutoSend } from "@/lib/create/auto-send";
import { useGenerationChoice } from "@/lib/create/use-generation-choice";
import { useOnline } from "@/lib/offline/use-online";

/** Kept under the URL size the server accepts, once encoded. */
const MAX_PROMPT_URL_LENGTH = 6000;

type Menu = "add" | "settings" | "deck" | null;

type Props = {
  placeholder: string;
  /** `start` is the larger first-run composer. */
  variant?: "flat" | "start";
  decks?: Array<{ id: string; name: string }>;
};

/** Sends the typed text to Create, which takes the conversation from there. */
export function HomeComposer({ placeholder, variant = "flat", decks = [] }: Props) {
  const router = useRouter();
  const online = useOnline();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<Menu>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { controls, flush } = useGenerationChoice(deckId);
  const settingsSummary = cardSettingsSummary(controls);

  const prompt = text.trim();
  const params = new URLSearchParams();
  if (deckId) params.set("deck", deckId);
  params.set("prompt", prompt);
  const tooLong = params.toString().length > MAX_PROMPT_URL_LENGTH;
  const canSend = prompt.length > 0 && online && !tooLong;

  async function send() {
    if (!canSend) return;
    // Create reads the deck's settings when it opens, so let a pending save land first.
    await flush();
    markAutoSend(prompt);
    router.push(`/create?${params}`);
  }

  // Grow the textarea with its content up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const deckLabel = decks.find((deck) => deck.id === deckId)?.name ?? "New deck";

  return (
    <div ref={rootRef} className={`dh-home-composer dh-home-composer--${variant}`}>
      <textarea
        ref={inputRef}
        className="dh-home-composer__input"
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label="Make new cards"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
      />
      {tooLong ? (
        <p className="dh-home-composer__hint">
          That&apos;s too long to send from here. Paste it in <Link href="/create">Create</Link>{" "}
          instead.
        </p>
      ) : !online ? (
        <p className="dh-home-composer__hint">Making cards needs a connection.</p>
      ) : null}
      <div className="dh-home-composer__row">
        <div className="dh-home-composer__anchor">
          <button
            type="button"
            className="dh-home-composer__add"
            aria-label="Add a source or import"
            aria-haspopup="menu"
            aria-expanded={menu === "add"}
            onClick={() => setMenu(menu === "add" ? null : "add")}
          >
            <i className="ri-add-line" aria-hidden />
          </button>
          {menu === "add" ? (
            <div className="dh-home-composer__menu" role="menu">
              <Link href="/create" role="menuitem" className="dh-menu-row">
                <i className="ri-attachment-2" aria-hidden />
                Add a source
              </Link>
              <div className="dh-menu-sep" />
              <Link href="/create?import=anki" role="menuitem" className="dh-menu-row">
                <i className="ri-folder-download-line" aria-hidden />
                Import from Anki
              </Link>
              <Link href="/create?import=quizlet" role="menuitem" className="dh-menu-row">
                <i className="ri-file-copy-2-line" aria-hidden />
                Import from Quizlet
              </Link>
            </div>
          ) : null}
        </div>
        <div className="dhc-menu-root dhc-menu-root--shrink">
          <button
            type="button"
            className="dh-home-tool dh-home-composer__settings"
            aria-haspopup="menu"
            aria-expanded={menu === "settings"}
            aria-label={settingsSummary.ariaLabel}
            title={settingsSummary.title}
            onClick={() => setMenu(menu === "settings" ? null : "settings")}
          >
            <i className="ri-equalizer-line" aria-hidden />
            <span className="dh-home-composer__deck-label">{settingsSummary.label}</span>
            <i className="ri-arrow-down-s-line" aria-hidden />
          </button>
          {menu === "settings" ? <CardSettingsMenu controls={controls} placement="down" /> : null}
        </div>
        <span className="dh-spacer" />
        {decks.length > 0 ? (
          <div className="dh-home-composer__anchor">
            <button
              type="button"
              className="dh-home-tool"
              aria-haspopup="menu"
              aria-expanded={menu === "deck"}
              onClick={() => setMenu(menu === "deck" ? null : "deck")}
            >
              <i className="ri-folder-3-line" aria-hidden />
              <span className="dh-home-composer__deck-label">{deckLabel}</span>
              <i className="ri-arrow-down-s-line" aria-hidden />
            </button>
            {menu === "deck" ? (
              <div
                className="dh-home-composer__menu dh-home-composer__menu--right"
                role="menu"
                aria-label="Choose a deck"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="dh-menu-row"
                  onClick={() => {
                    setDeckId(null);
                    setMenu(null);
                  }}
                >
                  <i className="ri-add-line" aria-hidden />
                  New deck
                </button>
                <div className="dh-menu-sep" />
                {decks.map((deck) => (
                  <button
                    key={deck.id}
                    type="button"
                    role="menuitem"
                    className="dh-menu-row"
                    onClick={() => {
                      setDeckId(deck.id);
                      setMenu(null);
                    }}
                  >
                    <i className="ri-folder-3-line" aria-hidden />
                    <span className="dh-home-composer__deck-label">{deck.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="dh-home-composer__send"
          aria-label="Send"
          disabled={!canSend}
          onClick={() => void send()}
        >
          <i className="ri-arrow-up-line" aria-hidden />
        </button>
      </div>
    </div>
  );
}
