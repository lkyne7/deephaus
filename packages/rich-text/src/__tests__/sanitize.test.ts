import { describe, expect, it } from "vitest";
import { sanitizeCardHtml } from "../serialize/sanitize.js";

describe("sanitizeCardHtml", () => {
  it("strips script tags and event handlers", () => {
    const out = sanitizeCardHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).toContain("Hi");
  });

  it("allows cloze and latex markers", () => {
    const out = sanitizeCardHtml(
      '<span data-cloze-id="c1" class="dh-cloze">ATP</span>',
    );
    expect(out).toContain('data-cloze-id="c1"');
    expect(out).toContain("ATP");
  });

  it("allows safe images and strips data/javascript sources", () => {
    const out = sanitizeCardHtml(
      '<img src="https://cdn.example.com/a.png" alt="diagram" onerror="alert(1)"><img src="data:text/html;base64,xx">',
    );
    expect(out).toContain('src="https://cdn.example.com/a.png"');
    expect(out).toContain('alt="diagram"');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("data:text/html");
  });
});
