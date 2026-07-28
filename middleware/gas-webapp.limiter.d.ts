declare const RATE_LIMITER_LOCK_TIMEOUT_MS = 5000;
/**
 * Used when a limiter isn't given a lockService — resolves LockService
 * directly, reproducing the limiters' original inline behavior exactly.
 * Pass GasLock to share one lock registry with the rest of the app.
 */
declare const GAS_WEBAPP_DEFAULT_LOCK_SERVICE: GasWebAppLockService;
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
