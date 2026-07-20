/** Never replace editable content once a user save has established an edit timestamp. */
export function shouldSeedExtractedContent(
  contentEditedAt: string | null | undefined,
): boolean {
  return contentEditedAt == null;
}
