export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryCondition?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: unknown;

  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnreset') ||
      message.includes('socket hang up')
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const retryCondition = config.retryCondition ?? isRetryableError;

  let lastError: unknown;
  let delay = config.initialDelay;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === config.maxAttempts || !retryCondition(error)) {
        throw error;
      }

      console.warn(
        `Attempt ${attempt}/${config.maxAttempts} failed, retrying in ${delay}ms...`,
        error instanceof Error ? error.message : error
      );

      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  throw new RetryError(
    `All ${config.maxAttempts} attempts failed`,
    config.maxAttempts,
    lastError
  );
}

export function createRetryWrapper(defaultOptions: Partial<RetryOptions> = {}) {
  return function <T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
    return withRetry(fn, { ...defaultOptions, ...options });
  };
}

export const inventoryRetry = createRetryWrapper({
  maxAttempts: 5,
  initialDelay: 500,
  maxDelay: 10000,
  retryCondition: (error) => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        isRetryableError(error) ||
        message.includes('deadlock') ||
        message.includes('lock wait timeout')
      );
    }
    return false;
  },
});
