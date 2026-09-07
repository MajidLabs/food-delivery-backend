export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes `fn` with exponential-backoff retry. Retries `retries` times
 * (up to retries+1 total attempts) before rethrowing the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    factor = 2,
    onRetry,
  } = options;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }
      onRetry?.(error, attempt);
      const delay = Math.min(baseDelayMs * factor ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }
}
