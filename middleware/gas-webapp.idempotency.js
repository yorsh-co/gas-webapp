'use strict';
/** Namespace for idempotency keys in the script cache. */
const GAS_WEBAPP_IDEMPOTENCY_KEY_PREFIX = 'idem';
/** CacheService's maximum expiration. */
const GAS_WEBAPP_IDEMPOTENCY_DEFAULT_TTL_SECONDS = 21600;
/** An in-flight marker outlives the 6-minute execution limit, then expires if its execution died. */
const GAS_WEBAPP_IDEMPOTENCY_PENDING_TTL_SECONDS = 6 * 60 + 60;
const GAS_WEBAPP_IDEMPOTENCY_PENDING_MARKER = 'pending';
const GAS_WEBAPP_IDEMPOTENCY_LOCK_TIMEOUT_MS = 10000;
/**
 * Makes a mutating route safe to retry. A request carrying the client's
 * `idempotencyKey` runs once: its success envelope is stored and replayed to
 * every later request with the same key, while a duplicate arriving mid-flight
 * gets a 409. A failed request clears its marker, so a retry runs again.
 *
 * This closes the gap `NOT_DELIVERED` leaves open: a call queued past the
 * client's ack deadline is reported as dropped and then runs, so the retry
 * would otherwise commit twice.
 *
 * Register it after auth so the key is scoped to `req.user.email`; without a
 * user the key is global to the script. Only JSON responses are stored: a
 * rendered view or text output clears the marker instead. A response too
 * large for CacheService (100 KB) is not stored, and its key can run again.
 *
 *   webApp.use('/api', auth, createIdempotencyGuard());
 */
const createIdempotencyGuard = (config = {}) => {
  const ttlSeconds =
    config.ttlSeconds ?? GAS_WEBAPP_IDEMPOTENCY_DEFAULT_TTL_SECONDS;
  const lockService = config.lockService ?? GAS_WEBAPP_DEFAULT_LOCK_SERVICE;
  const cacheKey = (req, key) => {
    const email = req.user?.email;
    return email
      ? `${GAS_WEBAPP_IDEMPOTENCY_KEY_PREFIX}:${email}:${key}`
      : `${GAS_WEBAPP_IDEMPOTENCY_KEY_PREFIX}:${key}`;
  };
  /** Returns the stored value, or null after marking the key as in flight. */
  const claim = (cache, key) => {
    const lock = lockService.getLock(config.lockScope ?? 'user');
    if (!lock || !lock.tryLock(GAS_WEBAPP_IDEMPOTENCY_LOCK_TIMEOUT_MS)) {
      throw new GasConflictError('Idempotency guard busy');
    }
    try {
      const stored = cache.get(key);
      if (stored === null) {
        cache.put(
          key,
          GAS_WEBAPP_IDEMPOTENCY_PENDING_MARKER,
          GAS_WEBAPP_IDEMPOTENCY_PENDING_TTL_SECONDS,
        );
      }
      return stored;
    } finally {
      lock.releaseLock();
    }
  };
  return (req, res, next) => {
    const idempotencyKey = req.query.idempotencyKey;
    if (idempotencyKey === undefined) return next();
    if (!GAS_WEBAPP_ACK_CALL_ID_PATTERN.test(idempotencyKey)) {
      throw new GasValidationError('Invalid idempotencyKey');
    }
    const cache = CacheService.getScriptCache();
    const key = cacheKey(req, idempotencyKey);
    const stored = claim(cache, key);
    if (stored === GAS_WEBAPP_IDEMPOTENCY_PENDING_MARKER) {
      throw new GasConflictError(
        'Request with this idempotency key is in progress',
      );
    }
    if (stored !== null) {
      const envelope = JSON.parse(stored);
      res.status(envelope.status).json(envelope.data);
      return;
    }
    try {
      next();
    } catch (err) {
      cache.remove(key);
      throw err;
    }
    const outcome = res.outcome;
    if (outcome?.kind !== 'json') {
      cache.remove(key);
      return;
    }
    try {
      cache.put(key, JSON.stringify(outcome.payload), ttlSeconds);
    } catch {
      cache.remove(key);
    }
  };
};
