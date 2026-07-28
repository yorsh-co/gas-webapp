'use strict';
const RATE_LIMITER_LOCK_TIMEOUT_MS = 10000;
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
 */
const createRateLimiter = (config) => {
  const lockService = config.lockService ?? GAS_WEBAPP_DEFAULT_LOCK_SERVICE;
  return (next) => (request) => {
    const cache = CacheService.getScriptCache();
    const windowBucket = Math.floor(Date.now() / (config.windowSeconds * 1000));
    const key = `ratelimit:${config.keyFn(request)}:${windowBucket}`;
    const windowEndMs = (windowBucket + 1) * config.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowEndMs - Date.now()) / 1000),
    );
    const lock = lockService.getLock(config.lockScope);
    if (!lock || !lock.tryLock(RATE_LIMITER_LOCK_TIMEOUT_MS)) {
      throw new RateLimitError(
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
      throw new RateLimitError(
        `Too many requests (${config.limit}/${config.windowSeconds}s)`,
        retryAfterSeconds,
      );
    }
    return next(request);
  };
};
/**
 * Caps simultaneous in-flight requests rather than requests-per-window.
 * The counter carries a short safety TTL so a crashed execution that
 * never reaches the `finally` release doesn't permanently hold a slot.
 */
const createConcurrencyLimiter = (config) => {
  const adjust = (key, lock, delta) => {
    if (!lock || !lock.tryLock(3000)) {
      if (delta > 0) throw new RateLimitError('Concurrency limiter busy');
      return -1; // best-effort release on contention — don't fail the response for this
    }
    try {
      const cache = CacheService.getScriptCache();
      const current = Number(cache.get(key) || '0');
      const next = Math.max(0, current + delta);
      cache.put(key, String(next), 60);
      return next;
    } finally {
      lock.releaseLock();
    }
  };
  return (next) => (request) => {
    const key = `concurrency:${config.keyFn(request)}`;
    const lock =
      config.lockScope === 'user'
        ? LockService.getUserLock()
        : LockService.getScriptLock();
    const after = adjust(key, lock, +1);
    if (after > config.limit) {
      adjust(key, lock, -1); // undo our own increment before failing
      throw new RateLimitError(
        `Too many concurrent requests (max ${config.limit})`,
      );
    }
    try {
      return next(request);
    } finally {
      adjust(key, lock, -1);
    }
  };
};
