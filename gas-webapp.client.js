'use strict';
/**
 * Routed client for the Apps Script backend.
 *
 * Every call goes through `google.script.run.doGet` / `doPost` with the
 * simulated event the router expects — `{ parameter: { route, callId, ...params },
 * postData?: { contents } }` — and resolves with the unwrapped `data` of the
 * success envelope, or rejects with a `ServerError`.
 *
 * Three failure modes are handled separately:
 *   - the server responded with an error   -> parsed off `withFailureHandler`
 *   - the server never responded in time   -> CLIENT_TIMEOUT
 *   - the call never reached Apps Script   -> NOT_DELIVERED, detected by the
 *     ack watcher below. `google.script.run` silently drops calls often enough
 *     that a plain timeout can't tell "slow" from "never arrived", and only the
 *     latter is safe to retry.
 *
 * Nothing else in a consuming app should talk to Apps Script directly.
 *
 * ```js
 * const health = await window.GasWebApp.api.get('/api/v1/healthcheck');
 * const result = await window.GasWebApp.api.post('/api/v1/uploads', payload);
 * ```
 */
window.GasWebApp = window.GasWebApp || {};
window.GasWebApp.api = window.GasWebApp.api || {};
(function (api) {
  'use strict';
  const DEFAULT_TIMEOUT_MS = 30000;
  const DEFAULT_GET_RETRIES = 2;
  const RETRY_BASE_MS = 400;
  /** Beyond this, waiting costs more than failing — the retry is abandoned. */
  const MAX_RETRY_DELAY_MS = 15000;
  const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
  /** Top-level route, deliberately outside the `/api/v1` limiter chain. */
  const ACK_ROUTE = '/ack';
  const ACK_POLL_INTERVAL_MS = 2000;
  const ACK_POLL_TIMEOUT_MS = 5000;
  /** How long a call may go unacknowledged before it counts as undelivered. */
  const ACK_DEADLINE_MS = 20000;
  const ACK_SCOPE = 'Ack Watcher';
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /** Exponential backoff, jittered across the upper half of each window. */
  function backoffMs(attempt) {
    const ceiling = RETRY_BASE_MS * Math.pow(2, attempt);
    return ceiling / 2 + Math.random() * (ceiling / 2);
  }
  function isRetryable(payload) {
    return RETRYABLE_STATUSES.indexOf(payload.status) !== -1;
  }
  /**
   * Honor `details.retryAfterSeconds` when the server supplies it (rate
   * limiters do), otherwise fall back to local backoff. Never shorter than the
   * server asked for — retrying inside a closed window just burns an attempt.
   */
  function retryDelayMs(payload, attempt) {
    const backoff = backoffMs(attempt);
    const details = payload.details;
    const retryAfter = details?.retryAfterSeconds;
    return typeof retryAfter === 'number' && retryAfter > 0
      ? Math.max(retryAfter * 1000, backoff)
      : backoff;
  }
  function buildEvent(method, route, options, callId) {
    const event = {
      parameter: { ...options.params, route },
    };
    if (callId) {
      event.parameter.callId = callId;
    }
    if (method === 'POST' && options.body !== undefined) {
      event.postData = {
        contents: JSON.stringify(options.body),
        type: 'application/json',
      };
    }
    return event;
  }
  const ackWaiters = new Map();
  let ackTimer = null;
  let ackPolling = false;
  /**
   * Resolves `true` once the server confirms it received `callId`, or `false`
   * once the ack deadline passes. All outstanding ids ride a single poll, so
   * concurrent requests cost one call per interval rather than one each.
   */
  function watchAck(callId) {
    return new Promise((resolve) => {
      ackWaiters.set(callId, {
        deadline: Date.now() + ACK_DEADLINE_MS,
        resolve,
      });
      scheduleAckPoll();
    });
  }
  function cancelAck(callId) {
    ackWaiters.delete(callId);
  }
  function settleAck(callId, arrived) {
    const waiter = ackWaiters.get(callId);
    if (!waiter) return;
    ackWaiters.delete(callId);
    waiter.resolve(arrived);
  }
  function scheduleAckPoll() {
    if (ackTimer !== null || ackPolling || ackWaiters.size === 0) return;
    ackTimer = setTimeout(pollAcks, ACK_POLL_INTERVAL_MS);
  }
  async function pollAcks() {
    ackTimer = null;
    ackPolling = true;
    try {
      const callIds = Array.from(ackWaiters.keys());
      if (callIds.length === 0) return;
      try {
        const arrived = await request('GET', ACK_ROUTE, {
          params: { callIds: callIds.join(',') },
          ack: false,
          retries: 0,
          timeoutMs: ACK_POLL_TIMEOUT_MS,
        });
        arrived.forEach((callId) => settleAck(callId, true));
      } catch {
        // A failed poll is not evidence of a failed request. Say nothing and
        // let the deadline decide.
        window.GasWebApp.logger.debug(ACK_SCOPE, 'Poll failed', {
          pending: callIds.length,
        });
      }
      const now = Date.now();
      Array.from(ackWaiters.entries()).forEach(([callId, waiter]) => {
        if (now >= waiter.deadline) settleAck(callId, false);
      });
    } finally {
      ackPolling = false;
      scheduleAckPoll();
    }
  }
  // =========================
  // TRANSPORT
  // =========================
  /**
   * One `google.script.run` call. Resolves with the unwrapped `data` of the
   * success envelope.
   *
   * `google.script.run` has no cancel API — a timeout only stops the client
   * waiting; the server execution runs to completion. `settled` keeps a late
   * handler from resolving a promise that already timed out.
   */
  function invoke(method, route, options, callId) {
    return new Promise((resolve, reject) => {
      const runner = window.google?.script?.run;
      if (!runner) {
        reject(
          new window.GasWebApp.errors.ServerError({
            ok: false,
            error: 'google.script.run is not available',
            status: 500,
            code: 'INTERNAL_ERROR',
          }),
        );
        return;
      }
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let settled = false;
      function settle(fn) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      }
      const timer = setTimeout(
        () =>
          settle(() =>
            reject(window.GasWebApp.errors.timeoutError(route, timeoutMs)),
          ),
        timeoutMs,
      );
      const chained = runner
        .withSuccessHandler((value) => settle(() => resolve(value.data)))
        .withFailureHandler((err) =>
          settle(() => {
            const error = err instanceof Error ? err : new Error(String(err));
            reject(
              new window.GasWebApp.errors.ServerError(
                window.GasWebApp.errors.parseServerError(error),
              ),
            );
          }),
        );
      // buildEvent (JSON.stringify of the body) and the RPC dispatch below are
      // synchronous and can throw before any handler above fires — a malformed
      // body, or google.script.run itself rejecting an oversized payload. Left
      // unguarded, that throw reaches request() as a plain Error with no
      // `.payload`, crashing the retry logic instead of surfacing as a normal
      // failed upload.
      try {
        const event = buildEvent(method, route, options, callId);
        if (method === 'POST') {
          chained.doPost(event);
        } else {
          chained.doGet(event);
        }
      } catch (err) {
        settle(() => reject(window.GasWebApp.errors.clientError(err)));
      }
    });
  }
  /**
   * One attempt, racing the response against delivery confirmation. A response
   * of any kind — success or server error — proves delivery, so the ack only
   * decides the case where nothing comes back at all.
   */
  async function attempt(method, route, options) {
    if (options.ack === false) return invoke(method, route, options, null);
    const callId = crypto.randomUUID();
    const result = invoke(method, route, options, callId);
    // An abandoned attempt must not surface as an unhandled rejection.
    result.catch(() => undefined);
    try {
      const delivered = await Promise.race([
        result.then(
          () => true,
          () => true,
        ),
        watchAck(callId),
      ]);
      if (!delivered) throw window.GasWebApp.errors.notDeliveredError(route);
      return await result;
    } finally {
      cancelAck(callId);
    }
  }
  /**
   * Attempt loop. GETs retry transient failures by default; POSTs do not,
   * because a timed-out or 5xx POST may already have committed server-side.
   * Pass `retries` explicitly to opt a POST route in — only for handlers that
   * are idempotent or carry their own idempotency key.
   */
  async function request(method, route, options = {}) {
    const scope = options.scope ?? `${method} ${route}`;
    const retries =
      options.retries ?? (method === 'GET' ? DEFAULT_GET_RETRIES : 0);
    for (let attemptIndex = 0; ; attemptIndex += 1) {
      try {
        return await attempt(method, route, options);
      } catch (err) {
        const error = err;
        const delay = retryDelayMs(error.payload, attemptIndex);
        if (
          attemptIndex >= retries ||
          !isRetryable(error.payload) ||
          delay > MAX_RETRY_DELAY_MS
        ) {
          window.GasWebApp.errors.logServerError(error, scope);
          throw error;
        }
        window.GasWebApp.logger.warn(scope, 'Retrying after failure', {
          attempt: attemptIndex + 1,
          delayMs: Math.round(delay),
          code: error.payload.code,
        });
        await sleep(delay);
      }
    }
  }
  api.request = request;
  api.get = (route, options = {}) => request('GET', route, options);
  api.post = (route, body, options = {}) =>
    request('POST', route, { ...options, body });
})(window.GasWebApp.api);
