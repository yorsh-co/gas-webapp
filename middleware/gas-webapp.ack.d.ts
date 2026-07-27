/** Namespace for acknowledgement keys in the script cache. */
declare const GAS_WEBAPP_ACK_KEY_PREFIX = 'ack';
/** UUID shape. Client-supplied, so it is validated before becoming a cache key. */
declare const GAS_WEBAPP_ACK_CALL_ID_PATTERN: RegExp;
/** Caps how many ids one poll may look up. */
declare const GAS_WEBAPP_ACK_MAX_CALL_IDS = 25;
declare const GAS_WEBAPP_ACK_DEFAULT_TTL_SECONDS = 60;
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
declare const createAckTracker: (
  config?: GasWebAppAckConfig,
) => GasWebAppAckTracker;
