/**
 * Request logging middleware factory.
 *
 * Stateless — takes the logger to use per call, so it isn't tied to any
 * app-specific logger instance. Binds reqId/transport once so every log
 * line for a request carries them without repeating them at each call
 * site — via logger.child(...) for GasLogger, or a small inline shim when
 * falling back to plain console (which has no .child()). Usage:
 *   webApp.use(createLoggingMiddleware(webappLogger));
 *
 * Peer dependency: GasLogger (gas-logger), if not passing plain `console`.
 */
const createLoggingMiddleware =
  (logger: GasLogger | typeof console = console): Middleware =>
  (next: Handler): Handler =>
  (request: RouteRequest) => {
    const start = Date.now();

    // build http logger
    const bindings = {
      reqId: request.reqId,
      transport: request.isHttpRequest ? 'http' : 'rpc',
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
    httpLogger.info(`-> ${request.method} ${request.route}`, {
      session: request.session,
      params: request.params,
    });

    try {
      const result = next(request);

      // log result
      httpLogger.info(
        `<- ${request.method} ${request.route} (${Date.now() - start}ms)`,
        {
          status: (result as JsonResponse).payload?.status,
        },
      );

      httpLogger.flush(); // for loggers using buffer

      return result;
    } catch (err) {
      // log error
      httpLogger.error(
        `x ${request.method} ${request.route} (${Date.now() - start}ms)`,
        {
          error: (err as Error).message,
        },
      );

      httpLogger.flush(); // for loggers using buffer

      throw err;
    }
  };
