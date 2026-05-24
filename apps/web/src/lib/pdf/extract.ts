import pdf from "pdf-parse/lib/pdf-parse.js";

export async function extractPdfText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const data = await pdf(buffer);
  const text = data.text?.trim() ?? "";
  const pageCount = data.numpages ?? 0;

  if (text.length < 50) {
    throw new Error(
      "Could not extract enough text from this PDF. Scanned PDFs are not supported yet.",
    );
  }

  const pages: string[] = [];
  const pageMatches = text.split(/\f/);
  if (pageMatches.length > 1) {
    pageMatches.forEach((page, i) => {
      if (page.trim()) pages.push(`--- Page ${i + 1} ---\n\n${page.trim()}`);
    });
  }

  return {
    text: pages.length > 0 ? pages.join("\n\n") : text,
    pageCount: pageCount || pages.length || 1,
  };
}
