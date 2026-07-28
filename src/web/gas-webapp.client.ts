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
window.GasWebApp = window.GasWebApp || ({} as GasWebAppNamespace);
window.GasWebApp.api = window.GasWebApp.api || ({} as GasWebAppApi);

(function (api: GasWebAppApi) {
  'use strict';

  /**
   * Read per call, never captured: `configure()` runs after this file loads,
   * and mutates the same object in place.
   */
  const config = (): GasWebAppClientConfig => window.GasWebApp.config;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Exponential backoff, jittered across the upper half of each window. */
  function backoffMs(attempt: number): number {
    const ceiling = config().retryBaseMs * Math.pow(2, attempt);
    return ceiling / 2 + Math.random() * (ceiling / 2);
  }

  function isRetryable(payload: GasErrorPayload): boolean {
    return config().retryableStatuses.indexOf(payload.status) !== -1;
  }

  /**
   * Honor `details.retryAfterSeconds` when the server supplies it (rate
   * limiters do), otherwise fall back to local backoff. Never shorter than the
   * server asked for — retrying inside a closed window just burns an attempt.
   */
  function retryDelayMs(payload: GasErrorPayload, attempt: number): number {
    const backoff = backoffMs(attempt);
    const details = payload.details as
      { retryAfterSeconds?: unknown } | undefined;
    const retryAfter = details?.retryAfterSeconds;

    return typeof retryAfter === 'number' && retryAfter > 0
      ? Math.max(retryAfter * 1000, backoff)
      : backoff;
  }

  function buildEvent(
    method: ApiMethod,
    route: string,
    options: ApiRequestOptions,
    callId: string | null,
  ): SimulatedEvent {
    const event: SimulatedEvent = {
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

  // =========================
  // ACK WATCHER
  // =========================

  interface AckWaiter {
    deadline: number;
    resolve: (arrived: boolean) => void;
  }

  const ackWaiters = new Map<string, AckWaiter>();
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  let ackPolling = false;

  /**
   * Resolves `true` once the server confirms it received `callId`, or `false`
   * once the ack deadline passes. All outstanding ids ride a single poll, so
   * concurrent requests cost one call per interval rather than one each.
   */
  function watchAck(callId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      ackWaiters.set(callId, {
        deadline: Date.now() + config().ackDeadlineMs,
        resolve,
      });
      scheduleAckPoll();
    });
  }

  function cancelAck(callId: string): void {
    ackWaiters.delete(callId);
  }

  function settleAck(callId: string, arrived: boolean): void {
    const waiter = ackWaiters.get(callId);
    if (!waiter) return;
    ackWaiters.delete(callId);
    waiter.resolve(arrived);
  }

  function scheduleAckPoll(): void {
    if (ackTimer !== null || ackPolling || ackWaiters.size === 0) return;
    ackTimer = setTimeout(pollAcks, config().ackPollIntervalMs);
  }

  async function pollAcks(): Promise<void> {
    ackTimer = null;
    ackPolling = true;

        const { ackRoute, ackPollTimeoutMs, ackScope } = config();


    try {
      const callIds = Array.from(ackWaiters.keys());
      if (callIds.length === 0) return;

      try {
        const arrived = await request<string[]>('GET', ackRoute, {
          params: { callIds: callIds.join(',') },
          ack: false,
          retries: 0,
          timeoutMs: ackPollTimeoutMs,
        });
        arrived.forEach((callId) => settleAck(callId, true));
      } catch {
        // A failed poll is not evidence of a failed request. Say nothing and
        // let the deadline decide.
        window.GasWebApp.logger.debug(ackScope, 'Poll failed', {
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
  function invoke<T>(
    method: ApiMethod,
    route: string,
    options: ApiRequestOptions,
    callId: string | null,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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

      const timeoutMs = options.timeoutMs ?? config().timeoutMs;
      let settled = false;

      function settle(fn: () => void): void {
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
        .withSuccessHandler((value: unknown) =>
          settle(() => resolve((value as SuccessPayload<T>).data)),
        )
        .withFailureHandler((err: unknown) =>
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
  async function attempt<T>(
    method: ApiMethod,
    route: string,
    options: ApiRequestOptions,
  ): Promise<T> {
    if (options.ack === false) return invoke<T>(method, route, options, null);

    const callId = crypto.randomUUID();
    const result = invoke<T>(method, route, options, callId);
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
  async function request<T>(
    method: ApiMethod,
    route: string,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const scope = options.scope ?? `${method} ${route}`;
    const retries =
      options.retries ?? (method === 'GET' ? config().getRetries : 0);

    for (let attemptIndex = 0; ; attemptIndex += 1) {
      try {
        return await attempt<T>(method, route, options);
      } catch (err) {
        const error = err as IServerError;
        const delay = retryDelayMs(error.payload, attemptIndex);

        if (
          attemptIndex >= retries ||
          !isRetryable(error.payload) ||
          delay > config().maxRetryDelayMs
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

  api.get = <T>(route: string, options: ApiRequestOptions = {}): Promise<T> =>
    request<T>('GET', route, options);

  api.post = <T>(
    route: string,
    body?: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> => request<T>('POST', route, { ...options, body });
})(window.GasWebApp.api);
