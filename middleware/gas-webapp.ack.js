'use strict';
/** Namespace for acknowledgement keys in the script cache. */
const GAS_WEBAPP_ACK_KEY_PREFIX = 'ack';
/** UUID shape. Client-supplied, so it is validated before becoming a cache key. */
const GAS_WEBAPP_ACK_CALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caps how many ids one poll may look up. */
const GAS_WEBAPP_ACK_MAX_CALL_IDS = 25;
const GAS_WEBAPP_ACK_DEFAULT_TTL_SECONDS = 60;
/**
 * Delivery acknowledgement for `google.script.run` callers.
 *
 * `google.script.run` drops calls silently often enough that a client cannot
 * distinguish "the server is slow" from "the request never arrived" — and only
 * the second is safe to retry. The middleware records the caller's `callId` the
 * moment a request enters the chain; the handler reports whether a given id was
 * recorded, then forgets it.
 *
 * The `callId` is a correlation token only. It is never trusted for
 * authorization, and because it is client-supplied it is format-validated
 * before being used as a cache key. Confidentiality rests on it being an
 * unguessable UUID, which is why acks are not scoped per user — under
 * `executeAs: USER_DEPLOYING` the user cache is shared regardless.
 *
 * Register the middleware first, ahead of auth and rate limiting: a request
 * that arrived and was then rejected must still be acknowledged, or the client
 * reads the rejection as a dropped call and retries it.
 *
 *   const ack = createAckTracker();
 *   webApp.use(ack.middleware);
 *   webApp.get('/ack', ack.handler);
 */
const createAckTracker = (config = {}) => {
  const ttlSeconds = config.ttlSeconds ?? GAS_WEBAPP_ACK_DEFAULT_TTL_SECONDS;
  const isValidCallId = (callId) => GAS_WEBAPP_ACK_CALL_ID_PATTERN.test(callId);
  const cacheKey = (callId) => `${GAS_WEBAPP_ACK_KEY_PREFIX}:${callId}`;
  const middleware = (next) => (request) => {
    const callId = request.params.callId;
    if (callId && isValidCallId(callId)) {
      CacheService.getScriptCache().put(cacheKey(callId), '1', ttlSeconds);
    }
    return next(request);
  };
  const handler = (request) => {
    const callIds = (request.params.callIds || '')
      .split(',')
      .filter(isValidCallId)
      .slice(0, GAS_WEBAPP_ACK_MAX_CALL_IDS);
    if (callIds.length === 0) return [];
    const cache = CacheService.getScriptCache();
    const found = cache.getAll(callIds.map(cacheKey));
    const arrived = callIds.filter((callId) => !!found[cacheKey(callId)]);
    if (arrived.length > 0) {
      cache.removeAll(arrived.map(cacheKey));
    }
    return arrived;
  };
  return { middleware, handler };
};
