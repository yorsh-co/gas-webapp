declare const RATE_LIMITER_LOCK_TIMEOUT_MS = 5000;
/**
 * Fixed-window counter backed by CacheService. The window boundary is
 * baked into the cache key, so expiry happens for free via CacheService's
 * TTL — no separate cleanup job needed.
 */
declare const createRateLimiter: (config: RateLimitConfig) => Middleware;
/**
 * Caps simultaneous in-flight requests rather than requests-per-window.
 * The counter carries a short safety TTL so a crashed execution that
 * never reaches the `finally` release doesn't permanently hold a slot.
 */
declare const createConcurrencyLimiter: (
  config: ConcurrencyLimitConfig,
) => Middleware;
