import { ConvexError } from 'convex/values';

type Provider = 'tmdb' | 'tvdb';

type ProviderFetchOptions = {
  provider: Provider;
  operation: string;
  timeoutMs?: number;
  retries?: number;
  beforeRequest?: () => Promise<boolean>;
};

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 2_000;

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const retryAfterMs = (response: Response) => {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
};

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

const backoffMs = (attempt: number, response?: Response) => {
  const requested = response ? retryAfterMs(response) : undefined;
  if (requested !== undefined) return Math.min(requested, MAX_RETRY_DELAY_MS);
  const exponential = 150 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
};

export async function providerFetch(url: string, init: RequestInit, options: ProviderFetchOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.beforeRequest && !(await options.beforeRequest()))
      throw new ConvexError({
        code: 'provider_global_limiter',
        provider: options.provider,
        retryable: true,
      });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (retryableStatus(response.status)) {
        if (attempt < retries) {
          await pause(backoffMs(attempt, response));
          continue;
        }
        console.info(
          '[metadata-provider]',
          JSON.stringify({
            provider: options.provider,
            operation: options.operation,
            outcome: 'error',
            status: response.status,
            attempts: attempt + 1,
            durationMs: Date.now() - startedAt,
          }),
        );
        throw new ConvexError({
          code: 'upstream',
          provider: options.provider,
          status: response.status,
          retryable: true,
        });
      }
      console.info(
        '[metadata-provider]',
        JSON.stringify({
          provider: options.provider,
          operation: options.operation,
          outcome: response.ok ? 'success' : 'rejected',
          status: response.status,
          attempts: attempt + 1,
          durationMs: Date.now() - startedAt,
        }),
      );
      return response;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof ConvexError) throw error;
      if (attempt < retries) {
        await pause(backoffMs(attempt));
        continue;
      }
      const timedOut =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError';
      console.info(
        '[metadata-provider]',
        JSON.stringify({
          provider: options.provider,
          operation: options.operation,
          outcome: timedOut ? 'timeout' : 'network-error',
          attempts: attempt + 1,
          durationMs: Date.now() - startedAt,
        }),
      );
      throw new ConvexError({
        code: timedOut ? 'timeout' : 'upstream',
        provider: options.provider,
        retryable: true,
      });
    }
  }

  throw new ConvexError({ code: 'upstream', provider: options.provider, retryable: true });
}
