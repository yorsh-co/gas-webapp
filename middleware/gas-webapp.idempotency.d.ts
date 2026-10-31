/** Namespace for idempotency keys in the script cache. */
declare const GAS_WEBAPP_IDEMPOTENCY_KEY_PREFIX = 'idem';
/** CacheService's maximum expiration. */
declare const GAS_WEBAPP_IDEMPOTENCY_DEFAULT_TTL_SECONDS = 21600;
/** An in-flight marker outlives the 6-minute execution limit, then expires if its execution died. */
declare const GAS_WEBAPP_IDEMPOTENCY_PENDING_TTL_SECONDS: number;
declare const GAS_WEBAPP_IDEMPOTENCY_PENDING_MARKER = 'pending';
declare const GAS_WEBAPP_IDEMPOTENCY_LOCK_TIMEOUT_MS = 10000;
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
declare const createIdempotencyGuard: (
  config?: GasWebAppIdempotencyConfig,
) => GasWebAppHandler;
