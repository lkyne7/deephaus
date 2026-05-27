export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message || `Request failed: ${status}`);
    this.name = "ApiError";
  }
}
