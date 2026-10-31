declare const GAS_WEBAPP_LOGGING_DEFAULT_REDACT: string[];
declare const GAS_WEBAPP_LOGGING_REDACTED = '[REDACTED]';
/**
 * Request logging middleware factory.
 *
 * Stateless — takes the logger to use per call, so it isn't tied to any
 * app-specific logger instance. Binds id/transport once so every log
 * line for a request carries them without repeating them at each call
 * site — via logger.child(...) for GasLogger, or a small inline shim when
 * falling back to plain console (which has no .child()).
 *
 * The response line is written once `next()` returns, so it reports the final
 * `res.statusCode` and the duration of everything downstream: `info` below 400,
 * `warn` from 400, `error` from 500. Errors are not logged here; `GasError.handle`
 * logs each once. The query is logged with the values of `options.redact` keys
 * masked; the body never is. Usage:
 *   webApp.use(createLoggingMiddleware(webappLogger));
 *
 * Peer dependency: GasLogger (gas-logger), if not passing plain `console`.
 */
declare const createLoggingMiddleware: (
  logger?: GasLogger | typeof console,
  options?: GasWebAppLoggingConfig,
) => GasWebAppHandler;
