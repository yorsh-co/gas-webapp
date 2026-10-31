declare const RATE_LIMITER_LOCK_TIMEOUT_MS = 10000;
declare const CONCURRENCY_LOCK_TIMEOUT_MS = 3000;
/** Longer wait for the one retry of a contended slot release. */
declare const CONCURRENCY_RELEASE_RETRY_TIMEOUT_MS = 10000;
/**
 * Safety TTL of a concurrency counter. Apps Script executions are capped at
 * 6 minutes, so a slot must outlive the longest possible request; the margin
 * covers clock skew and the final release.
 */
declare const CONCURRENCY_COUNTER_TTL_SECONDS: number;
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
 *
 * The counter is read and written under a lock, and `lockScope` must cover the
 * scope of `keyFn`'s key: a per-user key is safe under the default `'user'`
 * lock, but a key shared across users needs `'script'`. A script lock
 * serialises every request that goes through the limiter, each waiting up to
 * 10 s for it.
 */
declare const createRateLimiter: (config: RateLimitConfig) => GasWebAppHandler;
/**
 * Caps simultaneous in-flight requests rather than requests-per-window.
 * `lockScope` follows the same rule as in `createRateLimiter`.
 * The counter carries a safety TTL covering the 6-minute execution limit, so
 * a crashed execution that never reaches the `finally` release doesn't
 * permanently hold a slot. A contended release is retried once before the
 * slot is left to expire.
 */
declare const createConcurrencyLimiter: (
  config: ConcurrencyLimitConfig,
) => GasWebAppHandler;
