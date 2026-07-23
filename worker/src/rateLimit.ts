const MAX_RATE_LIMIT_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 429;
}

// @google/genai's ApiError exposes no HTTP headers, only status/message — so the retry delay
// is parsed from message's JSON body (a google.rpc.RetryInfo detail) instead of a Retry-After header.
// Shape of that body (details can hold other detail types too, hence the .find):
// { "error": { "details": [ { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "13s" } ] } }
interface RetryInfoDetail {
  '@type': string;
  retryDelay?: string;
}

function extractRetryDelayMs(err: unknown): number | null {
  const message = (err as { message?: string } | null)?.message;
  if (!message) return null;

  try {
    const body = JSON.parse(message);
    const details = body?.error?.details;
    if (!Array.isArray(details)) return null;

    const retryInfo = (details as RetryInfoDetail[]).find((d) => d['@type']?.includes('RetryInfo'));
    const retryDelay = retryInfo?.retryDelay;
    if (typeof retryDelay === 'string' && retryDelay.endsWith('s')) {
      const seconds = Number(retryDelay.slice(0, -1));
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  } catch {
    return null;
  }

  return null;
}

export async function withRateLimitRetry<T>(fn: () => Promise<T>, logPrefix = ''): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw err;
      }

      const retryInfoMs = extractRetryDelayMs(err);
      const waitMs = retryInfoMs ?? Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      const source = retryInfoMs !== null ? 'RetryInfo' : 'exponential-backoff fallback';
      console.warn(
        `${logPrefix}Gemini rate limited (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}), waiting ${waitMs}ms before retrying (source=${source})`
      );
      await sleep(waitMs);
      attempt += 1;
    }
  }
}
