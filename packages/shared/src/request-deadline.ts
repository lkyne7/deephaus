/** Shared transport deadlines. Mutations are never automatically replayed. */
export async function fetchWithDeadline(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  const method = (
    init.method ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.method
      : "GET")
  ).toUpperCase();
  const duration = timeoutMs ?? (method === "GET" ? 15_000 : 30_000);
  const externalSignal =
    init.signal ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.signal
      : undefined);
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Request timed out. Please retry.")),
    duration,
  );
  try {
    // Keep the deadline through body consumption, not just response headers.
    let response: Response;
    let retried = false;
    try {
      response = await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (method !== "GET" || controller.signal.aborted) throw error;
      retried = true;
      response = await fetch(input, { ...init, signal: controller.signal });
    }
    // One read retry shares the original deadline. Writes are never replayed.
    if (
      !retried &&
      method === "GET" &&
      [502, 503, 504].includes(response.status) &&
      !controller.signal.aborted
    ) {
      await response.body?.cancel();
      response = await fetch(input, { ...init, signal: controller.signal });
    }
    const body = await response.arrayBuffer();
    return new Response(
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
        ? null
        : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
