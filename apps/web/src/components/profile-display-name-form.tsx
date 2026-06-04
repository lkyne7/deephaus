"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateDisplayNameAction } from "@/lib/auth-actions";

type Props = {
  initialName: string;
};

export function ProfileDisplayNameForm({ initialName }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const result = await updateDisplayNameAction(name);
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    setSaved(true);
    setBusy(false);
    router.refresh();
  }

  const dirty = name.trim() !== initialName.trim();

  return (
    <form onSubmit={save} style={s.form}>
      <div className="field" style={{ flex: 1, minWidth: 200 }}>
        <label className="field-label" htmlFor="display-name">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          placeholder="How should we greet you?"
          autoComplete="name"
          maxLength={80}
          required
        />
      </div>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !dirty}>
        {busy ? "Saving…" : saved && !dirty ? "Saved" : "Save"}
      </button>
      {error ? <p style={s.error}>{error}</p> : null}
    </form>
  );
}

const s: Record<string, React.CSSProperties> = {
  form: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border-1)",
  },
  error: {
    width: "100%",
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
