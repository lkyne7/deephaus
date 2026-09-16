/** Serialize writes by account + record across editor instances and remounts. */
const queues = new Map<string, Promise<unknown>>();
export function serializeSave<T>(
  key: string,
  save: () => Promise<T>,
): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(save);
  queues.set(key, result);
  void result
    .finally(() => {
      if (queues.get(key) === result) queues.delete(key);
    })
    .catch(() => undefined);
  return result;
}
