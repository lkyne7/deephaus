import {
  createConsoleLogger,
  LogLevels,
  type LogRecord,
  type PowerSyncLogger,
} from "@powersync/common";

// A sync stream that drops mid-flight (sleep/wake, network change, PowerSync
// redeploy) rejects with a network-level error whose message varies by platform:
// Chrome `Failed to fetch` when the request never connects and `network error`
// when the response body is cut, Firefox `NetworkError`, Safari `Load failed`,
// React Native `Network request failed`, iOS Expo `fetch failed:
// UnexpectedException: The Internet connection appears to be offline` (also
// TLS failures, timeouts, and "network connection was lost"), and PowerSync's
// own HTTP 502/503 wrappers when the sync service is briefly unavailable.
const RETRYABLE_TRANSPORT_ERROR =
  /Failed to fetch|fetch failed|UnexpectedException|network error|NetworkError|Load failed|Network request failed|ERR_NETWORK|ECONNRESET|ETIMEDOUT|Internet connection appears to be offline|network connection was lost|request timed out|TLS error|bad gateway|service unavailable/i;

function isRetryableTransportError(error: unknown, message?: string): boolean {
  // The web shared sync worker structured-clones records before broadcasting
  // them to each tab, so the error arrives as an Error or as a plain string.
  const description =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return RETRYABLE_TRANSPORT_ERROR.test(`${message ?? ""} ${description}`);
}

/**
 * PowerSync logs every dropped sync stream as an error even though its connect
 * loop retries on its own. Report those as warnings so a transient reconnect is
 * not indistinguishable from an app bug (a red entry in the Next.js error
 * overlay, or noise in error tracking). Genuine failures — auth, schema, sync
 * processing — keep their original level.
 */
export function createSyncLogger(
  options: { prefix?: string } = {},
): PowerSyncLogger {
  const consoleLogger = createConsoleLogger({
    prefix: options.prefix ?? "PowerSync",
  });
  return {
    log(record: LogRecord) {
      const downgrade =
        record.level >= LogLevels.error &&
        isRetryableTransportError(record.error, record.message);
      consoleLogger.log(
        downgrade ? { ...record, level: LogLevels.warn } : record,
      );
    },
  };
}
