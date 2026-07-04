/* Sanity-check rich extraction + occlusion cropping on a real (LaTeX) PDF. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfRich } from "../src/lib/pdf/extract-rich";
import { extractSourceImages } from "../src/lib/sources/extract-images";

const OUT = join(process.cwd(), ".imgtest", "out");
const pdf = readFileSync(join(OUT, "attention.pdf"));

console.log("=== rich extraction (first 4 pages worth of output) ===");
const t0 = Date.now();
const rich = await extractPdfRich(pdf);
console.log(`extracted ${rich.pages.length}/${rich.pageCount} pages in ${Date.now() - t0}ms`);
for (const page of rich.pages.slice(0, 4)) {
  console.log(`--- Page ${page.pageNumber} ---`);
  for (const block of page.blocks) {
    if (block.kind === "image") {
      console.log(`  [image ${block.width}x${block.height}]`);
    } else if (block.kind === "heading") {
      console.log(
        `  h${block.level}: ${block.runs.map((r) => r.text).join("").slice(0, 80)}`,
      );
    } else if (block.kind === "bullets") {
      console.log(`  • x${block.items.length}: ${block.items[0]!.map((r) => r.text).join("").slice(0, 60)}`);
    } else {
      const text = block.runs.map((r) => r.text).join("");
      const styled = block.runs.some((r) => r.bold || r.italic) ? " {styled}" : "";
      console.log(`  p: ${text.slice(0, 80)}${styled}`);
    }
  }
}
const imageTotal = rich.pages.flatMap((p) => p.blocks).filter((b) => b.kind === "image").length;
console.log(`inline images total: ${imageTotal}`);

console.log("\n=== occlusion candidates (pages 1-6) ===");
const t1 = Date.now();
const images = await extractSourceImages(pdf, "pdf", { pageNumbers: [1, 2, 3, 4, 5, 6] });
console.log(`extracted ${images.length} candidate(s) in ${Date.now() - t1}ms`);
for (let i = 0; i < images.length; i += 1) {
  const img = images[i]!;
  console.log(`  ${img.ref}: ${img.width}x${img.height}`);
  writeFileSync(join(OUT, "crops", `attn-${i}-${img.ref.replace(/\s/g, "")}.png`), img.bytes);
}
