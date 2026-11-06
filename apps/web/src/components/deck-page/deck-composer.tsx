"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DETAIL_LEVEL_OPTIONS,
  FOCUS_PRESET_OPTIONS,
  detailLevelLabel,
  focusPresetOption,
  type DetailLevel,
  type FocusPreset,
} from "@deephaus/shared";
import { markAutoSend } from "@/lib/create/auto-send";
import { deckCreateHref } from "@/lib/decks/create-link";
import "@/components/create/create-chat.css";

type Intent = "edit" | "generate";
type OpenMenu = "settings" | "intent" | null;

/**
 * The deck page's way into the Create chat. Attachments and generation live
 * there, so this collects the message and its settings and hands them over.
 */
export function DeckComposer({
  deckId,
  defaults,
}: {
  deckId: string;
  /** The deck's saved generation settings; Create reloads these on its own. */
  defaults: { detail: DetailLevel; focus: FocusPreset };
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [detail, setDetail] = useState<DetailLevel>(defaults.detail);
  const [focus, setFocus] = useState<FocusPreset>(defaults.focus);
  const [intent, setIntent] = useState<Intent>("edit");
  const [menu, setMenu] = useState<OpenMenu>(null);
  const canSend = text.trim().length > 0;
  const href = deckCreateHref(deckId, {
    prompt: text,
    detail: detail === defaults.detail ? undefined : detail,
    focus: focus === defaults.focus ? undefined : focus,
    intent: text.trim() ? intent : undefined,
  });

  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      if (!rowRef.current?.contains(event.target as Node)) setMenu(null);
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

  function send() {
    if (!canSend) return;
    markAutoSend(text.trim());
    router.push(href);
  }

  return (
    <div className="dhc-composer dhc-composer--docked">
      <textarea
        className="dhc-composer__input"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Ask for changes, add a source, or make more cards…"
        aria-label="Message for this deck"
      />
      <div ref={rowRef} className="dhc-composer__row">
        <Link
          href={href}
          className="dhc-tool dhc-tool--icon"
          aria-label="Add a source"
          title="Add a source"
        >
          <i className="ri-add-line" aria-hidden />
        </Link>

        <div className="dhc-menu-root dhc-menu-root--shrink">
          <button
            type="button"
            className={`dhc-tool${menu === "settings" ? " is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={menu === "settings"}
            onClick={() => setMenu((current) => (current === "settings" ? null : "settings"))}
          >
            <i className="ri-equalizer-line dhc-tool__icon" aria-hidden />
            <span className="dhc-tool__label">
              {detailLevelLabel(detail)} · {focusPresetOption(focus).label}
            </span>
            <i className="ri-arrow-down-s-line dhc-tool__caret" aria-hidden />
          </button>
          {menu === "settings" ? (
            <div role="menu" aria-label="Card settings" className="dhc-menu dhc-menu--down dhc-menu--left dhd-composer-menu">
              <div className="dhd-composer-menu__label">Detail</div>
              {DETAIL_LEVEL_OPTIONS.map((option) => (
                <ChoiceRow
                  key={option.value}
                  label={option.label}
                  active={option.value === detail}
                  onClick={() => setDetail(option.value)}
                />
              ))}
              <div className="dh-menu-sep" />
              <div className="dhd-composer-menu__label">Focus</div>
              {FOCUS_PRESET_OPTIONS.map((option) => (
                <ChoiceRow
                  key={option.value}
                  label={option.label}
                  active={option.value === focus}
                  onClick={() => setFocus(option.value)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <span className="dhc-composer__spacer" />

        <div className="dhc-menu-root">
          <button
            type="button"
            className={`dhc-tool${menu === "intent" ? " is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={menu === "intent"}
            title="What this message does"
            onClick={() => setMenu((current) => (current === "intent" ? null : "intent"))}
          >
            <i
              className={`${intent === "edit" ? "ri-pencil-line" : "ri-sparkling-2-line"} dhc-tool__icon`}
              aria-hidden
            />
            <span className="dhc-tool__label">{intent === "edit" ? "Edit cards" : "New cards"}</span>
            <i className="ri-arrow-down-s-line dhc-tool__caret" aria-hidden />
          </button>
          {menu === "intent" ? (
            <div role="menu" aria-label="What this message does" className="dhc-menu dhc-menu--down dhc-menu--right dhd-composer-menu">
              <ChoiceRow
                label="Edit cards"
                active={intent === "edit"}
                onClick={() => {
                  setIntent("edit");
                  setMenu(null);
                }}
              />
              <ChoiceRow
                label="New cards"
                active={intent === "generate"}
                onClick={() => {
                  setIntent("generate");
                  setMenu(null);
                }}
              />
            </div>
          ) : null}
        </div>

        <button type="button" className="dhc-send" disabled={!canSend} onClick={send} aria-label="Send" title="Send (Enter)">
          <i className="ri-arrow-up-line" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ChoiceRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className="dh-menu-row dhd-composer-menu__row"
      onClick={onClick}
    >
      <span>{label}</span>
      {active ? <i className="ri-check-line" aria-hidden /> : null}
    </button>
  );
}
