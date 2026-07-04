import { clozeClassName } from "@deephaus/rich-text";
import { clozeHintPlaceholder } from "@deephaus/shared";
import { Fragment, type ReactNode } from "react";
import "@/components/rich-text/rich-text.css";

const CLOZE_RE = /\{\{c(\d+)::([\s\S]+?)(?::([\s\S]+?))?\}\}/g;

type Props = {
  content: string;
  /** Parse Anki-style {{c1::answer}} markers in the string. */
  cloze?: boolean;
  revealed?: boolean;
};

function renderClozeText(text: string, revealed: boolean): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(CLOZE_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(<Fragment key={key++}>{text.slice(lastIndex, index)}</Fragment>);
    }

    const id = `c${match[1]}`;
    const answer = match[2]!;
    const hint = match[3];
    parts.push(
      <span
        key={key++}
        className={clozeClassName(id)}
        {...(!revealed && hint ? { "data-cloze-hint": hint } : {})}
      >
        {revealed ? answer : clozeHintPlaceholder(hint)}
      </span>,
    );
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return parts;
}

/** SSR-safe card text for onboarding — avoids TipTap/DOMParser on the server. */
export function OnboardingCardContent({ content, cloze = false, revealed = false }: Props) {
  const className = `dh-card-content-renderer is-study${
    cloze ? (revealed ? " is-revealed" : " is-hidden") : ""
  }`;

  return (
    <div className={className}>
      {cloze ? renderClozeText(content, revealed) : content}
    </div>
  );
}
