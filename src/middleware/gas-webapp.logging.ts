/**
 * Request logging middleware factory.
 *
 * Stateless — takes the logger to use per call, so it isn't tied to any
 * app-specific logger instance. Binds id/transport once so every log
 * line for a request carries them without repeating them at each call
 * site — via logger.child(...) for GasLogger, or a small inline shim when
 * falling back to plain console (which has no .child()). The response line is
 * written once `next()` returns, so it reports the status and duration of
 * everything downstream. Usage:
 *   webApp.use(createLoggingMiddleware(webappLogger));
 *
 * Peer dependency: GasLogger (gas-logger), if not passing plain `console`.
 */
const createLoggingMiddleware =
  (logger: GasLogger | typeof console = console): GasWebAppHandler =>
  (req, res, next) => {
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
            info: (msg: string, meta?: Record<string, unknown>) =>
              logger.info(msg, { ...bindings, ...meta }),
            error: (msg: string, meta?: Record<string, unknown>) =>
              logger.error(msg, { ...bindings, ...meta }),
            flush: (): void => {},
          };

    // log request
    httpLogger.info(`-> ${req.method} ${req.originalPath}`, {
      user: req.user,
      params: req.query,
    });

    next();

    // log result
    httpLogger.info(
      `<- ${req.method} ${req.originalPath} (${Date.now() - start}ms)`,
      { status: res.statusCode },
    );

    httpLogger.flush(); // for loggers using buffer
  };
