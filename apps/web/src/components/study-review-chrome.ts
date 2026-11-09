/** Grades and shortcuts shared by the deck, combined and exam reviewers. */

export type StudyGradeId = "again" | "hard" | "good" | "easy";

export const STUDY_GRADES: Array<{
  id: StudyGradeId;
  rating: 1 | 2 | 3 | 4;
  label: string;
  /** Plain-language explanation shown as a tooltip on the grade button. */
  hint: string;
  color: string;
}> = [
  {
    id: "again",
    rating: 1,
    label: "Again",
    hint: "Forgot it. You'll see this card again this session",
    color: "var(--grade-again)",
  },
  {
    id: "hard",
    rating: 2,
    label: "Hard",
    hint: "Remembered, but it was a struggle. Comes back sooner",
    color: "var(--grade-hard)",
  },
  {
    id: "good",
    rating: 3,
    label: "Good",
    hint: "Remembered with a little effort. The usual choice",
    color: "var(--grade-good)",
  },
  {
    id: "easy",
    rating: 4,
    label: "Easy",
    hint: "Knew it instantly. Waits much longer before returning",
    color: "var(--grade-easy)",
  },
];

export const STUDY_ACTION_SHORTCUTS = {
  explain: "X",
  edit: "E",
  suspend: "@",
  zoomOut: "[",
  zoomIn: "]",
  undo: "ArrowLeft",
  redo: "ArrowRight",
} as const;
