"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import "@/components/deck-import.css";

function carriesFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

/** File zone for the import forms: click to browse, or drop a file on it. */
export function ImportDropzone({
  accept,
  title,
  hint,
  compact = false,
  onFiles,
}: {
  accept: string;
  title: string;
  hint: ReactNode;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    onFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={`dhi-drop${compact ? " dhi-drop--compact" : ""}${over ? " is-over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <i className="ri-upload-cloud-2-line" aria-hidden />
        <span className="dhi-drop__title">{title}</span>
        <span className="dhi-drop__hint">{hint}</span>
      </button>
    </>
  );
}

export function ImportToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="dhi-row">
      <span className="dhi-row__text">
        {label}
        {hint ? <span className="dhi-row__hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        className="dh-toggle"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}

export function ImportActions({
  onBack,
  backLabel,
  submitLabel,
  submitDisabled,
  onSubmit,
}: {
  onBack?: () => void;
  backLabel: string;
  submitLabel: string;
  submitDisabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="dhi-actions">
      {onBack ? (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          {backLabel}
        </button>
      ) : (
        <Link href="/create" className="btn btn-ghost">
          {backLabel}
        </Link>
      )}
      <button type="button" className="btn btn-primary" disabled={submitDisabled} onClick={onSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}

export function ImportResult({
  summary,
  decks,
  children,
}: {
  summary: string;
  decks: Array<{ id: string; name: string; cardCount: number }>;
  children?: ReactNode;
}) {
  return (
    <div className="dhi-result">
      <div className="dhi-result__head">
        <i className="ri-checkbox-circle-fill" aria-hidden />
        <span>{summary}</span>
      </div>
      {children}
      <div className="dhi-result__decks">
        {decks.map((deck) => (
          <div key={deck.id} className="dhi-deck">
            <span className="dhi-deck__name">{deck.name}</span>
            <span className="dhi-deck__count">{deck.cardCount.toLocaleString()} cards</span>
            <Link href={`/decks/${deck.id}`} className="btn btn-secondary btn-sm">
              Open deck
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
