import { ApiError } from "./errors.js";
import { resolveAuth, type DeepHausClientOptions } from "./options.js";

export type RequestContext = {
  options: DeepHausClientOptions;
};

async function authHeaders(options: DeepHausClientOptions) {
  const auth = resolveAuth(options);
  if (auth.type === "bearer") {
    const token = await auth.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return {};
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

export async function apiRequest<T>(
  ctx: RequestContext,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const extra = await authHeaders(ctx.options);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  const auth = resolveAuth(ctx.options);
  const response = await fetch(`${normalizeBaseUrl(ctx.options.baseUrl)}${path}`, {
    ...init,
    headers,
    credentials: auth.type === "credentials" ? "include" : init?.credentials,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiRequestBlob(
  ctx: RequestContext,
  path: string,
  init?: RequestInit,
): Promise<Blob> {
  const headers = new Headers(init?.headers);
  const extra = await authHeaders(ctx.options);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  const auth = resolveAuth(ctx.options);
  const response = await fetch(`${normalizeBaseUrl(ctx.options.baseUrl)}${path}`, {
    ...init,
    headers,
    credentials: auth.type === "credentials" ? "include" : init?.credentials,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response.blob();
}
