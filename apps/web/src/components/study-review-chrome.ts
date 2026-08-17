/**
 * Shared visual chrome for the study reviewer, used by both the default
 * deck reviewer (study-mode.tsx) and the cram reviewer (cram-study-mode.tsx)
 * so the two sessions look identical.
 */

export type StudyGradeId = "again" | "hard" | "good" | "easy";

export const STUDY_GRADES: Array<{
  id: StudyGradeId;
  rating: 1 | 2 | 3 | 4;
  label: string;
  /** Plain-language explanation shown as a tooltip on the grade button. */
  hint: string;
  color: string;
  bg: string;
}> = [
  {
    id: "again",
    rating: 1,
    label: "Again",
    hint: "Forgot it — you'll see this card again this session",
    color: "var(--grade-again)",
    bg: "var(--grade-again-bg)",
  },
  {
    id: "hard",
    rating: 2,
    label: "Hard",
    hint: "Remembered, but it was a struggle — comes back sooner",
    color: "var(--grade-hard)",
    bg: "var(--grade-hard-bg)",
  },
  {
    id: "good",
    rating: 3,
    label: "Good",
    hint: "Remembered with a little effort — the usual choice",
    color: "var(--grade-good)",
    bg: "var(--grade-good-bg)",
  },
  {
    id: "easy",
    rating: 4,
    label: "Easy",
    hint: "Knew it instantly — waits much longer before returning",
    color: "var(--grade-easy)",
    bg: "var(--grade-easy-bg)",
  },
];

export const REVIEW_PRIMARY_ROW_HEIGHT = 72;
export const REVIEW_CHROME_RADIUS = 12;
/** Inner radius when the chrome has a 1px border. */
export const REVIEW_CHROME_INNER_RADIUS = REVIEW_CHROME_RADIUS - 1;

export const studyReviewStyles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    padding: "24px 40px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 940,
    width: "100%",
    margin: "0 auto",
    minHeight: 0,
    overflow: "hidden",
  },
  errorBanner: {
    flexShrink: 0,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--grade-again-bg)",
    color: "var(--grade-again)",
    font: "500 13px/18px var(--font-sans)",
    textAlign: "center",
  },
  cardChrome: {
    background: "var(--white)",
    borderRadius: REVIEW_CHROME_RADIUS,
    border: "1px solid var(--border-2)",
    padding: "24px 32px",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
  },
  divider: { width: "60%", height: 1, background: "var(--border-1)" },
  progressBar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "var(--ink-50)" },
  progressFill: { height: 3, background: "var(--teal-500)", transition: "width .25s" },
  showBtn: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
    border: 0,
    padding: "0 20px",
    font: "500 16px/20px var(--font-sans)",
    textAlign: "center",
    cursor: "pointer",
    borderTopLeftRadius: REVIEW_CHROME_INNER_RADIUS,
    borderTopRightRadius: REVIEW_CHROME_INNER_RADIUS,
  },
  gradeMeta: {
    font: "400 11px/1 var(--font-sans)",
    color: "var(--fg-4)",
    marginTop: 6,
    width: "100%",
    textAlign: "center",
  },
  reviewChrome: {
    background: "var(--white)",
    borderRadius: REVIEW_CHROME_RADIUS,
    border: "1px solid var(--border-2)",
    overflow: "visible",
    flexShrink: 0,
  },
  reviewPrimaryRow: {
    height: REVIEW_PRIMARY_ROW_HEIGHT,
    borderBottom: "1px solid var(--border-1)",
    overflow: "visible",
  },
  gradeBar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    width: "100%",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
  },
  reviewFooterBar: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
    borderTop: "1px solid var(--border-secondary)",
  },
  reviewFooterSide: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  },
  reviewFooterCenter: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  gradeBtn: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
    padding: "0 8px",
    textAlign: "center",
    border: 0,
    background: "var(--white)",
    transition: "background .15s",
  },
};
