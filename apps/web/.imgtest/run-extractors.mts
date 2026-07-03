/* Exercises the new rich extractors + occlusion cropping against the fixtures.
 * Run from apps/web:
 *   NODE_OPTIONS="--conditions=react-server" pnpm dlx tsx .imgtest/run-extractors.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { extractPdfRich } from "../src/lib/pdf/extract-rich";
import { extractPptxRich } from "../src/lib/pptx/extract-rich";
import { extractSourceImages } from "../src/lib/sources/extract-images";
import { detectOcclusionRectsByOcr } from "../src/lib/occlusion/ocr";
import { extractDocxHtml } from "../src/lib/docx/extract-html";
import { htmlToSourceDoc } from "../src/lib/sources/html-to-doc";

const OUT = join(process.cwd(), ".imgtest", "out");
mkdirSync(join(OUT, "crops"), { recursive: true });

function runSummary(runs: { text: string; bold?: boolean; italic?: boolean }[]): string {
  return runs
    .map((r) => `${r.bold ? "**" : ""}${r.italic ? "_" : ""}${r.text}${r.italic ? "_" : ""}${r.bold ? "**" : ""}`)
    .join("");
}

console.log("=== 1. PDF rich extraction ===");
const pdfBuffer = readFileSync(join(OUT, "fixture.pdf"));
const pdfRich = await extractPdfRich(pdfBuffer);
for (const page of pdfRich.pages) {
  console.log(`--- Page ${page.pageNumber} ---`);
  for (const block of page.blocks) {
    if (block.kind === "image") {
      console.log(`  [image ${block.width}x${block.height}, ${block.bytes.length}b]`);
      writeFileSync(join(OUT, "crops", `pdf-inline-p${page.pageNumber}.png`), block.bytes);
    } else if (block.kind === "heading") {
      console.log(`  h${block.level}: ${runSummary(block.runs)}`);
    } else if (block.kind === "bullets") {
      for (const item of block.items) console.log(`  • ${runSummary(item)}`);
    } else {
      console.log(`  p: ${runSummary(block.runs).slice(0, 100)}`);
    }
  }
}

console.log("\n=== 2. PPTX rich extraction ===");
const pptxBuffer = readFileSync(join(OUT, "fixture.pptx"));
const slides = await extractPptxRich(pptxBuffer);
for (const slide of slides) {
  console.log(`--- Slide ${slide.slideNumber} ---`);
  for (const item of slide.items) {
    if (item.kind === "image") console.log(`  [image ${item.mime}, ${item.bytes.length}b]`);
    else if (item.kind === "title") console.log(`  TITLE: ${runSummary(item.runs)}`);
    else {
      for (const p of item.paragraphs) {
        console.log(`  ${p.bullet ? "•" : "p:"} ${runSummary(p.runs)}`);
      }
    }
  }
}

console.log("\n=== 3. DOCX html (mammoth) ===");
const docxBuffer = readFileSync(join(OUT, "fixture.docx"));
let docxImages = 0;
const html = await extractDocxHtml(docxBuffer, async (bytes) => {
  docxImages += 1;
  writeFileSync(join(OUT, "crops", `docx-inline-${docxImages}.png`), bytes);
  return `mock://img-${docxImages}`;
});
console.log(html.slice(0, 600));
const docxDoc = htmlToSourceDoc(html);
console.log(`doc blocks: ${docxDoc.content?.length}, images uploaded: ${docxImages}`);

console.log("\n=== 4. PDF occlusion figure crops ===");
const pdfImages = await extractSourceImages(pdfBuffer, "pdf");
console.log(`extracted ${pdfImages.length} occlusion candidate(s)`);
for (let i = 0; i < pdfImages.length; i += 1) {
  const img = pdfImages[i]!;
  writeFileSync(join(OUT, "crops", `pdf-occl-${i}-${img.ref.replace(/\s/g, "")}.png`), img.bytes);
  console.log(`  ${img.ref}: ${img.width}x${img.height}`);
}

console.log("\n=== 5. OCR label detection on first crop ===");
if (pdfImages.length > 0) {
  const rects = await detectOcclusionRectsByOcr(pdfImages[0]!.bytes);
  for (const rect of rects) {
    console.log(
      `  "${rect.label}" @ (${rect.x.toFixed(2)}, ${rect.y.toFixed(2)}) ${(rect.width * 100).toFixed(0)}%x${(rect.height * 100).toFixed(0)}%`,
    );
  }
  console.log(`  → ${rects.length} label region(s)`);
}

console.log("\n=== 6. PPTX occlusion composites ===");
const pptxImages = await extractSourceImages(pptxBuffer, "pptx");
console.log(`extracted ${pptxImages.length} slide composite(s)`);
for (let i = 0; i < pptxImages.length; i += 1) {
  writeFileSync(join(OUT, "crops", `pptx-occl-${i}.png`), pptxImages[i]!.bytes);
}

console.log("\ndone");
