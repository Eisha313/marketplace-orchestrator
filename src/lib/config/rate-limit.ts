export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  keyPrefix: 'rl',
};

export const vendorApiRateLimitConfig: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 200,
  keyPrefix: 'vendor',
};

export const webhookRateLimitConfig: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 50,
  keyPrefix: 'webhook',
};

export const publicApiRateLimitConfig: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'public',
};

export function getConfigForPath(pathname: string): RateLimitConfig {
  if (pathname.includes('/webhook')) {
    return webhookRateLimitConfig;
  }
  if (pathname.includes('/vendors/') || pathname.includes('/inventory/')) {
    return vendorApiRateLimitConfig;
  }
  if (pathname.includes('/products/compare')) {
    return publicApiRateLimitConfig;
  }
  return defaultRateLimitConfig;
}
