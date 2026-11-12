export class ApiError extends Error {
  readonly body: unknown;
  readonly code: string | null;

  constructor(
    readonly status: number,
    responseBody: string,
  ) {
    let body: unknown = null;
    try {
      body = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      body = responseBody || null;
    }
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    // An error page (a proxy, a crashed route) is HTML: not something to show.
    const isMarkup = /^\s*</.test(responseBody);
    const message =
      typeof record?.error === "string"
        ? record.error
        : responseBody && !isMarkup
          ? responseBody
          : status >= 500
            ? "Something went wrong on our side. Try again in a moment."
            : `Request failed: ${status}`;
    super(message);
    this.name = "ApiError";
    this.body = body;
    this.code = typeof record?.code === "string" ? record.code : null;
  }
}
