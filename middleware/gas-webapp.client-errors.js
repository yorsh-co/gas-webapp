'use strict';
const GAS_WEBAPP_CLIENT_ERROR_KINDS = [
  'logged',
  'uncaught',
  'unhandledrejection',
];
const GAS_WEBAPP_CLIENT_ERROR_LIMITS = {
  message: 1000,
  stack: 4000,
  scope: 100,
  url: 500,
  userAgent: 300,
  context: 2000,
};
const GAS_WEBAPP_CLIENT_ERROR_TIMESTAMP_MAX = 100;
const GAS_WEBAPP_CLIENT_ERROR_DEFAULT_SCOPE = 'Client';
const GAS_WEBAPP_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const GAS_WEBAPP_CLIENT_ERROR_CONTEXT_OMITTED = '[context omitted]';
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
const createClientErrorHandler = (logger = console, config = {}) => {
  const limits = { ...GAS_WEBAPP_CLIENT_ERROR_LIMITS };
  for (const key of Object.keys(limits)) {
    const value = config.limits?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      limits[key] = value;
    }
  }
  const text = (value, max) =>
    typeof value === 'string' ? value.slice(0, max) : undefined;
  const sanitizeContext = (value) => {
    if (value === undefined) return undefined;
    try {
      const json = JSON.stringify(value);
      if (json === undefined) return undefined;
      return json.length > limits.context
        ? GAS_WEBAPP_CLIENT_ERROR_CONTEXT_OMITTED
        : JSON.parse(json);
    } catch {
      return GAS_WEBAPP_CLIENT_ERROR_CONTEXT_OMITTED;
    }
  };
  return (req, res) => {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new GasValidationError('Client error report must be an object');
    }
    const report = body;
    const message = text(report.message, limits.message);
    if (!message?.trim()) {
      throw new GasValidationError('Client error report needs a message');
    }
    if (!GAS_WEBAPP_CLIENT_ERROR_KINDS.includes(report.kind)) {
      throw new GasValidationError('Invalid client error kind');
    }
    const scope =
      text(
        typeof report.scope === 'string'
          ? report.scope.replace(GAS_WEBAPP_CONTROL_CHARS, ' ')
          : undefined,
        limits.scope,
      )?.trim() || GAS_WEBAPP_CLIENT_ERROR_DEFAULT_SCOPE;
    logger.error(`Client error: ${scope}`, {
      kind: report.kind,
      message,
      stack: text(report.stack, limits.stack),
      url: text(report.url, limits.url),
      userAgent: text(report.userAgent, limits.userAgent),
      clientTimestamp: text(
        report.timestamp,
        GAS_WEBAPP_CLIENT_ERROR_TIMESTAMP_MAX,
      ),
      context: sanitizeContext(report.context),
      user: req.user,
      reqId: req.id,
    });
    if ('flush' in logger) logger.flush();
    res.status(202).json({ received: true });
  };
};
