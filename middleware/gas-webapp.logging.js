'use strict';
const GAS_WEBAPP_LOGGING_DEFAULT_REDACT = [
  'token',
  'password',
  'secret',
  'key',
  'auth',
  'authorization',
];
const GAS_WEBAPP_LOGGING_REDACTED = '[REDACTED]';
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
const createLoggingMiddleware = (logger = console, options = {}) => {
  const redacted = new Set(
    (options.redact ?? GAS_WEBAPP_LOGGING_DEFAULT_REDACT).map((key) =>
      key.toLowerCase(),
    ),
  );
  const redactQuery = (query) => {
    const safe = {};
    for (const key of Object.keys(query)) {
      safe[key] = redacted.has(key.toLowerCase())
        ? GAS_WEBAPP_LOGGING_REDACTED
        : query[key];
    }
    return safe;
  };
  return (req, res, next) => {
    const start = Date.now();
    // build http logger
    const bindings = {
      reqId: req.id,
      transport: req.transport,
    };
    const httpLogger =
      'child' in logger
        ? logger.child(bindings)
        : {
            info: (msg, meta) => logger.info(msg, { ...bindings, ...meta }),
            warn: (msg, meta) => logger.warn(msg, { ...bindings, ...meta }),
            error: (msg, meta) => logger.error(msg, { ...bindings, ...meta }),
            flush: () => {},
          };
    // log request
    httpLogger.info(`-> ${req.method} ${req.originalPath}`, {
      user: req.user,
      params: redactQuery(req.query),
    });
    next();
    // log result
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    httpLogger[level](
      `<- ${req.method} ${req.originalPath} (${Date.now() - start}ms)`,
      { status },
    );
    httpLogger.flush(); // for loggers using buffer
  };
};
