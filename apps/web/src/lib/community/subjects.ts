/** The subjects a published deck can be filed under, in the order they are shown. */
export const COMMUNITY_SUBJECTS = [
  { value: "medicine", label: "Medicine" },
  { value: "biology", label: "Biology" },
  { value: "chemistry", label: "Chemistry" },
  { value: "physics", label: "Physics" },
  { value: "maths", label: "Maths" },
  { value: "computing", label: "Computing" },
  { value: "languages", label: "Languages" },
  { value: "law", label: "Law" },
  { value: "history", label: "History" },
  { value: "psychology", label: "Psychology" },
  { value: "business", label: "Business" },
  { value: "other", label: "Other" },
] as const;

export type CommunitySubject = (typeof COMMUNITY_SUBJECTS)[number]["value"];

export const COMMUNITY_SUBJECT_VALUES = COMMUNITY_SUBJECTS.map((subject) => subject.value) as [
  CommunitySubject,
  ...CommunitySubject[],
];

const LABELS = new Map<string, string>(COMMUNITY_SUBJECTS.map((subject) => [subject.value, subject.label]));

export function subjectLabel(value: string | null | undefined): string | null {
  return value ? (LABELS.get(value) ?? null) : null;
}
