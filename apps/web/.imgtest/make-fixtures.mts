/* Fixture builder: labeled diagram PNG, DOCX + PPTX (hand-built zips), and an
 * HTML page for Chrome print-to-PDF. Run from apps/web:
 *   NODE_OPTIONS="--conditions=react-server" npx tsx .imgtest/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

const OUT = join(import.meta.dirname, "out");
mkdirSync(OUT, { recursive: true });

// --- 1. Labeled diagram PNG (OCR-friendly labels) ---------------------------

async function makeDiagram(): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const w = 900;
  const h = 640;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Cell body
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(430, 320, 260, 200, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Nucleus
  ctx.beginPath();
  ctx.ellipse(430, 320, 90, 70, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Mitochondria blob
  ctx.beginPath();
  ctx.ellipse(300, 220, 46, 24, 0.5, 0, Math.PI * 2);
  ctx.stroke();
  // Ribosome dot
  ctx.beginPath();
  ctx.arc(560, 420, 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#111";
  ctx.font = "600 28px Helvetica";
  const label = (text: string, x: number, y: number, lx: number, ly: number) => {
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(x - 6, y - 8);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillText(text, x, y);
  };
  label("Nucleus", 690, 250, 505, 290);
  label("Mitochondria", 60, 150, 280, 208);
  label("Ribosome", 640, 480, 570, 428);
  label("Membrane", 120, 540, 260, 470);

  return canvas.toBuffer("image/png");
}

// --- 2. DOCX ------------------------------------------------------------------

function docxDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Cell Biology</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">The cell is the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>basic unit of life</w:t></w:r><w:r><w:t xml:space="preserve"> and contains many </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>specialized organelles</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Structure</w:t></w:r></w:p>
    <w:p><w:r><w:t>The diagram below shows the main organelles of a eukaryotic cell.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="5400000" cy="3840000"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>Mitochondria generate most of the chemical energy needed to power the cell's biochemical reactions.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
}

async function makeDocx(diagram: Buffer): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
  );
  zip.file("word/document.xml", docxDocumentXml());
  zip.file("word/media/image1.png", diagram);
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

// --- 3. PPTX -------------------------------------------------------------------

function slide1Xml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="685800" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>
      <p:txBody><a:p><a:r><a:rPr lang="en-US"/><a:t>The Eukaryotic Cell</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="685800" y="1825625"/><a:ext cx="3886200" cy="3505200"/></a:xfrm></p:spPr>
      <p:txBody>
        <a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>Nucleus</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> stores genetic material</a:t></a:r></a:p>
        <a:p><a:r><a:rPr lang="en-US" i="1"/><a:t>Mitochondria</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> produce ATP energy</a:t></a:r></a:p>
        <a:p><a:r><a:rPr lang="en-US"/><a:t>Ribosomes synthesize proteins</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
    <p:pic>
      <p:nvPicPr><p:cNvPr id="5" name="Diagram"/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
      <p:spPr><a:xfrm><a:off x="4800600" y="1825625"/><a:ext cx="3886200" cy="2743200"/></a:xfrm></p:spPr>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`;
}

function slide2Xml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="685800" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>
      <p:txBody><a:p><a:r><a:t>Membrane Transport</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="685800" y="1825625"/><a:ext cx="7772400" cy="1505200"/></a:xfrm></p:spPr>
      <p:txBody>
        <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Passive transport moves molecules along the concentration gradient without energy input from the cell.</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
}

async function makePptx(diagram: Buffer): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz w="9144000" h="6858000"/>
</p:presentation>`,
  );
  zip.file("ppt/slides/slide1.xml", slide1Xml());
  zip.file("ppt/slides/slide2.xml", slide2Xml());
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`,
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  );
  zip.file("ppt/media/image1.png", diagram);
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

// --- 4. HTML for Chrome print-to-PDF -------------------------------------------

function makeHtml(diagramB64: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Georgia, serif; font-size: 13px; margin: 48px; }
  h1 { font-size: 30px; } h2 { font-size: 20px; }
  .pb { page-break-before: always; }
  img { width: 430px; }
</style></head><body>
  <h1>Cell Biology Primer</h1>
  <p>The cell is the <b>basic structural unit</b> of all living organisms. Every cell is enclosed by a <i>plasma membrane</i> that separates its interior from the environment.</p>
  <h2>Organelles</h2>
  <ul>
    <li>Nucleus — stores the genome and coordinates gene expression</li>
    <li>Mitochondria — produce ATP by oxidative phosphorylation</li>
    <li>Ribosomes — translate mRNA into protein</li>
  </ul>
  <p>Figure 1 shows a labeled diagram of a typical animal cell with its principal organelles.</p>
  <img src="data:image/png;base64,${diagramB64}">
  <p>The <b>nucleus</b> is bounded by a double membrane called the nuclear envelope, which is perforated by nuclear pores.</p>
  <h2 class="pb">Membrane Transport</h2>
  <p>Substances cross membranes by <i>passive</i> or <b>active</b> transport. Passive transport requires no metabolic energy.</p>
  <p>Osmosis is the diffusion of water across a selectively permeable membrane toward the compartment with higher solute concentration.</p>
</body></html>`;
}

// --- main -----------------------------------------------------------------------

const diagram = await makeDiagram();
writeFileSync(join(OUT, "diagram.png"), diagram);
writeFileSync(join(OUT, "fixture.docx"), await makeDocx(diagram));
writeFileSync(join(OUT, "fixture.pptx"), await makePptx(diagram));
writeFileSync(join(OUT, "fixture.html"), makeHtml(diagram.toString("base64")));
console.log("fixtures written to", OUT);
