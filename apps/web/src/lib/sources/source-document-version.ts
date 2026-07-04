/**
 * A source document save replaces the full ProseMirror JSON blob, so the client
 * must prove it is saving the version it originally loaded.
 */
export function isCurrentSourceDocumentVersion(
  currentEditedAt: string | null,
  expectedEditedAt: string | null | undefined,
): boolean {
  return expectedEditedAt !== undefined && currentEditedAt === expectedEditedAt;
}
