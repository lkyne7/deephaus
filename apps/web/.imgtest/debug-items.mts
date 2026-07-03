import { readFileSync } from "node:fs";
import { join } from "node:path";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const buffer = readFileSync(join(process.cwd(), ".imgtest", "out", "fixture.pdf"));
const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
const page = await doc.getPage(1);
const tc = await page.getTextContent();
for (const item of tc.items as { str: string; transform: number[]; width: number; hasEOL?: boolean; fontName?: string }[]) {
  if (item.str !== undefined) {
    console.log(
      JSON.stringify(item.str).slice(0, 48).padEnd(50),
      "x=", item.transform?.[4]?.toFixed(0),
      "y=", item.transform?.[5]?.toFixed(0),
      "eol=", item.hasEOL ? 1 : 0,
    );
  }
}
await doc.destroy();
