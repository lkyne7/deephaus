import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notionRedirectUri } from "../redirect-uri";
import { requestOrigin } from "../request-origin";
import { safeReturnPath } from "../safe-return-path";

const ORIGINAL_ENV = {
  NOTION_REDIRECT_URI: process.env.NOTION_REDIRECT_URI,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("notionRedirectUri", () => {
  beforeEach(() => {
    delete process.env.NOTION_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(restoreEnv);

  it("uses an explicit Notion redirect URI when configured", () => {
    process.env.NOTION_REDIRECT_URI = " https://oauth.deephaus.app/api/notion/callback ";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deephaus.app";

    expect(notionRedirectUri("https://preview.deephaus.app")).toBe(
      "https://oauth.deephaus.app/api/notion/callback",
    );
  });

  it("falls back to NEXT_PUBLIC_APP_URL without duplicating slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.deephaus.app/";

    expect(notionRedirectUri("https://preview.deephaus.app")).toBe(
      "https://app.deephaus.app/api/notion/callback",
    );
  });

  it("uses the live request origin when no app URL is configured", () => {
    expect(notionRedirectUri("http://localhost:3000/")).toBe(
      "http://localhost:3000/api/notion/callback",
    );
  });
});

describe("requestOrigin", () => {
  it("prefers forwarded host and the first forwarded protocol", () => {
    const request = new Request("http://internal.local/api/notion/connect", {
      headers: {
        "x-forwarded-host": "app.deephaus.com",
        "x-forwarded-proto": "https, http",
      },
    });

    expect(requestOrigin(request)).toBe("https://app.deephaus.com");
  });

  it("defaults host-based requests to https when no forwarded protocol is present", () => {
    const request = new Request("http://internal.local/api/notion/connect", {
      headers: {
        host: "deephaus.com",
      },
    });

    expect(requestOrigin(request)).toBe("https://deephaus.com");
  });

  it("falls back to the request URL origin when proxy headers are absent", () => {
    const request = new Request("http://localhost:3000/api/notion/connect");

    expect(requestOrigin(request)).toBe("http://localhost:3000");
  });
});

describe("safeReturnPath", () => {
  it("keeps app-relative return paths", () => {
    expect(safeReturnPath("/notes?notion=connect")).toBe("/notes?notion=connect");
  });

  it.each([null, undefined, "", "https://evil.example/notes", "//evil.example/notes"])(
    "falls back to notes for unsafe return path %s",
    (value) => {
      expect(safeReturnPath(value)).toBe("/notes");
    },
  );
});
