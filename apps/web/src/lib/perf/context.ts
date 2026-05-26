import { AsyncLocalStorage } from "node:async_hooks";

export type RequestPerfContext = {
  userId?: string | null;
  dbMs: number;
  dbQueries: number;
};

export const requestPerfContext = new AsyncLocalStorage<RequestPerfContext>();

export function getRequestPerfContext(): RequestPerfContext {
  return requestPerfContext.getStore() ?? { dbMs: 0, dbQueries: 0 };
}

export function addDbTiming(ms: number) {
  const store = requestPerfContext.getStore();
  if (!store) return;
  store.dbMs += ms;
  store.dbQueries += 1;
}

export function setRequestUserId(userId: string | null | undefined) {
  const store = requestPerfContext.getStore();
  if (!store) return;
  store.userId = userId ?? null;
}
