'use strict';
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
  (logger = console) =>
  (next) =>
  (request) => {
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
            info: (msg, meta) => logger.info(msg, { ...bindings, ...meta }),
            error: (msg, meta) => logger.error(msg, { ...bindings, ...meta }),
            flush: () => {},
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
          status: result.payload?.status,
        },
      );
      httpLogger.flush(); // for loggers using buffer
      return result;
    } catch (err) {
      // log error
      httpLogger.error(
        `x ${request.method} ${request.route} (${Date.now() - start}ms)`,
        {
          error: err.message,
        },
      );
      httpLogger.flush(); // for loggers using buffer
      throw err;
    }
  };
