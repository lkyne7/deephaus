import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractMistralPages } from "../mistral.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mistral OCR adapter", () => {
  it("requests selected zero-based pages and normalizes rich blocks", async () => {
    const response = JSON.parse(
      await readFile(
        new URL("./fixtures/mistral-ocr-page.json", import.meta.url),
        "utf8",
      ),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pages = await extractMistralPages({
      documentUrl: "https://storage.example/signed-document",
      pageNumbers: [1],
      inspections: [],
      apiKey: "test-key",
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "equation",
      "table",
      "image",
      "caption",
    ]);
    expect(pages[0]?.blocks[2]?.latex).toBe("E = mc^2");
    expect(pages[0]?.blocks[3]?.table).toEqual({
      rowCount: 2,
      columnCount: 2,
    });
    expect(pages[0]?.blocks[4]?.image?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(pages[0]?.blocks[5]?.text).toBe("Figure 1. Measured curve.");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe("mistral-ocr-4-0");
    expect(body.pages).toEqual([0]);
    expect(body.include_blocks).toBe(true);
    expect(body.include_confidence_scores).toBe(true);
    expect(body.table_format).toBe("html");
    expect(body.include_image_base64).toBe(true);
  });

  it("preserves a numbered Transformer equation as renderable LaTeX", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pages: [
            {
              index: 3,
              markdown:
                "$$\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$ (1)",
              blocks: [
                {
                  id: "attention-equation",
                  type: "equation",
                  content:
                    "$$\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$ (1)",
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [page] = await extractMistralPages({
      documentUrl: "https://arxiv.org/pdf/1706.03762",
      pageNumbers: [4],
      inspections: [],
      apiKey: "test-key",
    });

    expect(page?.pageNumber).toBe(4);
    expect(page?.blocks[0]).toMatchObject({
      kind: "equation",
      latex:
        "\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V \\tag{1}",
    });
  });
});
