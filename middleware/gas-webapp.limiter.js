'use strict';
const RATE_LIMITER_LOCK_TIMEOUT_MS = 10000;
const CONCURRENCY_LOCK_TIMEOUT_MS = 3000;
/** Longer wait for the one retry of a contended slot release. */
const CONCURRENCY_RELEASE_RETRY_TIMEOUT_MS = 10000;
/**
 * Safety TTL of a concurrency counter. Apps Script executions are capped at
 * 6 minutes, so a slot must outlive the longest possible request; the margin
 * covers clock skew and the final release.
 */
const CONCURRENCY_COUNTER_TTL_SECONDS = 6 * 60 + 60;
/**
 * Used when a limiter isn't given a lockService — resolves LockService
 * directly, reproducing the limiters' original inline behavior exactly.
 * Pass GasLock to share one lock registry with the rest of the app.
 */
const GAS_WEBAPP_DEFAULT_LOCK_SERVICE = Object.freeze({
  getLock(scope) {
    return scope === 'user'
      ? LockService.getUserLock()
      : LockService.getScriptLock();
  },
});
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
const createRateLimiter = (config) => {
  const lockService = config.lockService ?? GAS_WEBAPP_DEFAULT_LOCK_SERVICE;
  return (req, _res, next) => {
    const cache = CacheService.getScriptCache();
    const windowBucket = Math.floor(Date.now() / (config.windowSeconds * 1000));
    const key = `ratelimit:${config.keyFn(req)}:${windowBucket}`;
    const windowEndMs = (windowBucket + 1) * config.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowEndMs - Date.now()) / 1000),
    );
    const lock = lockService.getLock(config.lockScope ?? 'user');
    if (!lock || !lock.tryLock(RATE_LIMITER_LOCK_TIMEOUT_MS)) {
      throw new GasRateLimitError(
        'Too many requests — try again',
        retryAfterSeconds,
      );
    }
    let count;
    try {
      count = Number(cache.get(key) || '0') + 1;
      cache.put(key, String(count), config.windowSeconds);
    } finally {
      lock.releaseLock();
    }
    if (count > config.limit) {
      throw new GasRateLimitError(
        `Too many requests (${config.limit}/${config.windowSeconds}s)`,
        retryAfterSeconds,
      );
    }
    next();
  };
};
/**
 * Caps simultaneous in-flight requests rather than requests-per-window.
 * `lockScope` follows the same rule as in `createRateLimiter`.
 * The counter carries a safety TTL covering the 6-minute execution limit, so
 * a crashed execution that never reaches the `finally` release doesn't
 * permanently hold a slot. A contended release is retried once before the
 * slot is left to expire.
 */
const createConcurrencyLimiter = (config) => {
  const lockService = config.lockService ?? GAS_WEBAPP_DEFAULT_LOCK_SERVICE;
  const adjust = (key, lock, delta) => {
    const timeouts =
      delta > 0
        ? [CONCURRENCY_LOCK_TIMEOUT_MS]
        : [CONCURRENCY_LOCK_TIMEOUT_MS, CONCURRENCY_RELEASE_RETRY_TIMEOUT_MS];
    if (!lock || !timeouts.some((timeoutMs) => lock.tryLock(timeoutMs))) {
      if (delta > 0) throw new GasRateLimitError('Concurrency limiter busy');
      return -1; // best-effort release on contention — don't fail the response for this
    }
    try {
      const cache = CacheService.getScriptCache();
      const current = Number(cache.get(key) || '0');
      const next = Math.max(0, current + delta);
      cache.put(key, String(next), CONCURRENCY_COUNTER_TTL_SECONDS);
      return next;
    } finally {
      lock.releaseLock();
    }
  };
  return (req, _res, next) => {
    const key = `concurrency:${config.keyFn(req)}`;
    const lock = lockService.getLock(config.lockScope ?? 'user');
    const after = adjust(key, lock, +1);
    if (after > config.limit) {
      adjust(key, lock, -1); // undo our own increment before failing
      throw new GasRateLimitError(
        `Too many concurrent requests (max ${config.limit})`,
      );
    }
    try {
      next();
    } finally {
      adjust(key, lock, -1);
    }
  };
};
