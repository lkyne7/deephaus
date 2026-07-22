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
    const message =
      typeof record?.error === "string"
        ? record.error
        : responseBody || `Request failed: ${status}`;
    super(message);
    this.name = "ApiError";
    this.body = body;
    this.code = typeof record?.code === "string" ? record.code : null;
  }
}
