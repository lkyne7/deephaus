import mammoth from "mammoth";

const MIN_TEXT_CHARS = 50;

export async function extractDocxText(buffer: Buffer): Promise<{ text: string; pageCount: null }> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim() ?? "";

  if (text.length < MIN_TEXT_CHARS) {
    throw new Error(
      "Could not extract enough text from this Word document. Try a .docx file with more content.",
    );
  }

  return { text, pageCount: null };
}
