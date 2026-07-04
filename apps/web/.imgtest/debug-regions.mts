import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectPdfImageRegions } from "../src/lib/pdf/extract-rich";

const pdf = readFileSync(join(process.cwd(), ".imgtest", "out", "attention.pdf"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const ops = pdfjs.OPS as unknown as Record<string, number>;
const doc = await pdfjs.getDocument({
  data: new Uint8Array(pdf),
  isOffscreenCanvasSupported: false,
}).promise;

for (const n of [3, 4]) {
  const page = await doc.getPage(n);
  await page.getOperatorList();
  const regions = await collectPdfImageRegions(page, ops);
  console.log(`Page ${n}: view=${JSON.stringify(page.view)}`);
  for (const r of regions) {
    console.log(
      `  region x=${r.x.toFixed(0)} y=${r.y.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)} px=${r.pixelWidth}x${r.pixelHeight}`,
    );
  }
}
