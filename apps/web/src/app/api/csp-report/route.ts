import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 8_192;

type CspReport = {
  "csp-report"?: {
    "document-uri"?: string;
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
  };
};

function pathOnly(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 200);
  }
}

/**
 * Receives violations of the report-only Content-Security-Policy and logs one
 * line each, without query strings, so the policy can be checked before it is
 * enforced. Public by design; oversized or malformed bodies are dropped.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY_BYTES) {
      const report = (JSON.parse(text) as CspReport)["csp-report"];
      if (report) {
        console.warn(
          "[csp-report]",
          JSON.stringify({
            directive: report["effective-directive"] ?? report["violated-directive"],
            blocked: pathOnly(report["blocked-uri"]),
            page: pathOnly(report["document-uri"]),
          }),
        );
      }
    }
  } catch {
    // Not a CSP report.
  }
  return new NextResponse(null, { status: 204 });
}
