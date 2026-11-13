declare const GAS_WEBAPP_CLIENT_ERROR_KINDS: readonly GasWebAppClientErrorKind[];
declare const GAS_WEBAPP_CLIENT_ERROR_LIMITS: Required<GasWebAppClientErrorLimits>;
declare const GAS_WEBAPP_CLIENT_ERROR_TIMESTAMP_MAX = 100;
declare const GAS_WEBAPP_CLIENT_ERROR_DEFAULT_SCOPE = 'Client';
declare const CONTROL_CHARS: RegExp;
declare const GAS_WEBAPP_CLIENT_ERROR_CONTEXT_OMITTED = '[context omitted]';
/**
 * Client error report handler factory.
 *
 * Receives reports posted by the browser reporter, treats every field as
 * untrusted (unknown keys dropped, strings truncated, `context` re-serialized
 * and capped), logs one `error` line carrying the report, the request user and
 * the request id, flushes buffered loggers, and answers 202. Malformed bodies
 * throw `GasValidationError` (400). Control characters in `scope` are replaced
 * with spaces so it cannot forge log lines. Flush errors are not caught: if
 * `flush()` throws after the line is logged, the error propagates (the client
 * gets a 500 and the reporter does not retry). Sheet formula injection is escaped by
 * gas-logger itself.
 *
 * The handler keeps no throttling state; mount it behind a rate limiter. To
 * raise a Google Chat alert, pass a logger decorated with gas-chat's
 * `chat.logger(...)`. Usage:
 *   webApp.post(
 *     '/client-errors',
 *     createRateLimiter({
 *       limit: 20,
 *       windowSeconds: 60,
 *       keyFn: (req) => `client-errors:${req.user?.email ?? 'anon'}`,
 *     }),
 *     createClientErrorHandler(log),
 *   );
 *
 * Peer dependency: GasLogger (gas-logger), if not passing plain `console`.
 */
declare const createClientErrorHandler: (
  logger?: GasLogger | typeof console,
  config?: GasWebAppClientErrorConfig,
) => GasWebAppHandler;
