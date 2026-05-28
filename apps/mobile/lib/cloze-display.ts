/** Anki-style cloze markdown: {{c1::answer}} or {{c2::answer::hint}} */
const CLOZE_PATTERN = /\{\{c(\d+)::([^:}]*)(?:::([^}]*))?\}\}/gi;

export function formatClozeForStudy(
  text: string,
  mode: "hidden" | "revealed" | "none",
  activeClozeOrd?: number | null,
): string {
  if (!text || mode === "none") return text;
  const hideAll = mode === "hidden" && (activeClozeOrd == null || activeClozeOrd <= 0);

  return text.replace(CLOZE_PATTERN, (_match, id, answer, hint) => {
    const ord = Number.parseInt(id, 10);
    if (mode === "hidden") {
      if (hideAll || ord === activeClozeOrd) {
        const hintText = hint?.trim();
        return hintText || "[...]";
      }
      return answer;
    }
    return answer;
  });
}
