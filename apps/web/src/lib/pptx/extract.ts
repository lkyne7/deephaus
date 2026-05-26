import JSZip from "jszip";

const MIN_TEXT_CHARS = 50;

export async function extractPptxText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slidePaths.length === 0) {
    throw new Error("No slides found in this PowerPoint file.");
  }

  const slides: string[] = [];
  for (let i = 0; i < slidePaths.length; i += 1) {
    const xml = await zip.file(slidePaths[i])!.async("text");
    const lines = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((match) => decodeXmlEntities(match[1] ?? "").trim())
      .filter(Boolean);
    const slideText = lines.join(" ").replace(/\s+/g, " ").trim();
    if (slideText) {
      slides.push(`--- Slide ${i + 1} ---\n\n${slideText}`);
    }
  }

  const text = slides.join("\n\n");
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error(
      "Could not extract enough text from this PowerPoint. Slides may be image-only.",
    );
  }

  return { text, pageCount: slides.length };
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
