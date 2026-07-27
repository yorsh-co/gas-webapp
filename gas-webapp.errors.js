'use strict';
/**
 * Server error contract for the client.
 *
 * `errorHandler` always throws, and for `google.script.run` callers
 * `GasWebApp._handleRequest` re-throws — so every server-side failure reaches
 * the client through `withFailureHandler` as an `Error` whose `.message` is the
 * JSON payload `{ ok, error, status, code, details? }`.
 *
 * Two failure modes have no server counterpart and are synthesized here:
 * `CLIENT_TIMEOUT` (deadline passed while the server kept working) and
 * `NOT_DELIVERED` (the call never reached Apps Script).
 */
window.GasWebApp = window.GasWebApp || {};
(function () {
  'use strict';
  const CLIENT_TIMEOUT_CODE = 'CLIENT_TIMEOUT';
  const NOT_DELIVERED_CODE = 'NOT_DELIVERED';
  /** Fallback for anything that isn't a recoverable server payload. */
  function defaultErrorPayload(message) {
    return {
      ok: false,
      error: 'Unexpected error',
      status: 500,
      code: 'INTERNAL_ERROR',
      details: message,
    };
  }
  /**
   * Extract the `GasErrorPayload` from an error thrown across
   * `google.script.run`. Apps Script may prefix the message, so the JSON is
   * located rather than assumed to start at index 0.
   */
  function parseServerError(err) {
    const message = err && err.message ? err.message : String(err);
    const jsonStartIndex = message.indexOf('{');
    if (jsonStartIndex === -1) return defaultErrorPayload(message);
    try {
      return JSON.parse(message.slice(jsonStartIndex));
    } catch {
      return defaultErrorPayload(message);
    }
  }
  /** The single error type every `GasWebApp.api` rejection carries. */
  class ServerError extends Error {
    constructor(payload) {
      super(payload.error);
      this.name = 'ServerError';
      this.payload = payload;
    }
    get status() {
      return this.payload.status;
    }
    get code() {
      return this.payload.code;
    }
  }
  /** Deadline passed with no response. The server call is still running. */
  function timeoutError(route, timeoutMs) {
    return new ServerError({
      ok: false,
      error: 'Request timed out',
      status: 504,
      code: CLIENT_TIMEOUT_CODE,
      details: { route, timeoutMs },
    });
  }
  /**
   * The call was never acknowledged, so it most likely never arrived. 503 keeps
   * it inside the retryable set.
   */
  function notDeliveredError(route) {
    return new ServerError({
      ok: false,
      error: 'Request never reached the server',
      status: 503,
      code: NOT_DELIVERED_CODE,
      details: { route },
    });
  }
  /**
   * Report a failed server call. Accepts either a `ServerError` or a raw error
   * off `withFailureHandler`, and returns the payload for the caller to act on.
   */
  function logServerError(err, scope = 'Server Error') {
    const payload =
      err instanceof ServerError ? err.payload : parseServerError(err);
    // TODO: later, use payload.status to determine the log level
    window.GasWebApp.logger.error(
      scope,
      payload.error || 'Unknown error',
      payload,
    );
    return payload;
  }
  window.GasWebApp.errors = {
    CLIENT_TIMEOUT_CODE,
    NOT_DELIVERED_CODE,
    ServerError,
    parseServerError,
    logServerError,
    timeoutError,
    notDeliveredError,
  };
})();
