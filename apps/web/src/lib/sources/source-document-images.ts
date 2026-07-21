/** Match only actual TipTap image nodes, recursively, without URL rewriting. */
export function sourceDocumentHasImageUrl(content: unknown, imageUrl: string): boolean {
  if (!content || typeof content !== "object" || Array.isArray(content)) return false;

  const node = content as {
    type?: unknown;
    attrs?: unknown;
    content?: unknown;
  };
  if (
    node.type === "image" &&
    node.attrs &&
    typeof node.attrs === "object" &&
    !Array.isArray(node.attrs) &&
    (node.attrs as { src?: unknown }).src === imageUrl
  ) {
    return true;
  }

  return (
    Array.isArray(node.content) &&
    node.content.some((child) => sourceDocumentHasImageUrl(child, imageUrl))
  );
}
