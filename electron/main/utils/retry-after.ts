export const MAX_RETRY_DELAY_MS = 60_000;

function clampRetryDelay(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, value))
    : 0;
}

/** Parse the OpenAI millisecond header and the standard Retry-After header. */
export function getRetryAfterMsFromHeaders(
  headers: Record<string, string> | undefined,
  now = Date.now()
): number {
  if (!headers) return 0;

  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  const retryAfterMillisecondsHeader = normalizedHeaders.get("retry-after-ms");
  const retryAfterMilliseconds = Number(retryAfterMillisecondsHeader);
  if (
    retryAfterMillisecondsHeader?.trim() &&
    Number.isFinite(retryAfterMilliseconds)
  ) {
    return clampRetryDelay(retryAfterMilliseconds);
  }

  const retryAfter = normalizedHeaders.get("retry-after");
  if (!retryAfter) return 0;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return clampRetryDelay(seconds * 1000);

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? clampRetryDelay(retryAt - now) : 0;
}
