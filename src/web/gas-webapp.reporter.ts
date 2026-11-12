/**
 * Optional client error reporter. Forwards `logger.error` calls, and
 * optionally uncaught errors, to the server route mounted with
 * `createClientErrorHandler`.
 *
 * Load this after `gas-webapp.client`. Without it the client behaves as
 * before. Call `install()` after `configure({ logger })`: it wraps the current
 * logger, and a later `configure({ logger })` replaces the wrapper.
 *
 * ```js
 * window.GasWebApp.configure({ logger: window.App.log });
 * window.GasWebApp.reporter.install({ route: '/client-errors' });
 * ```
 */
window.GasWebApp = window.GasWebApp || ({} as GasWebAppNamespace);

(function () {
  'use strict';

  const REPORTER_SCOPE = 'Error Reporter';
  const DEFAULT_MAX_REPORTS = 10;
  const DEFAULT_DEDUPE_MS = 60000;
  /** Codes minted on the client; the server never logged these. */
  const CLIENT_CODES = ['CLIENT_TIMEOUT', 'NOT_DELIVERED', 'CLIENT_ERROR'];

  let installed = false;

  /**
   * True for a payload `GasError.handle` already logged on the server, which
   * would otherwise alert twice.
   */
  function isServerPayload(context: unknown): boolean {
    if (typeof context !== 'object' || context === null) return false;
    if (window.GasWebApp.errors._isClientMinted(context)) return false;
    const payload = context as { ok?: unknown; code?: unknown };
    return (
      payload.ok === false &&
      typeof payload.code === 'string' &&
      CLIENT_CODES.indexOf(payload.code) === -1
    );
  }

  /** Returns `context` when it survives JSON, otherwise a short description. */
  function serializableContext(context: unknown): unknown {
    if (context === undefined) return undefined;
    if (context instanceof Error) {
      const described: { name: string; message: string; payload?: unknown } = {
        name: context.name,
        message: context.message,
      };
      const payload = (context as { payload?: unknown }).payload;
      if (payload !== undefined) described.payload = payload;
      return described;
    }
    try {
      JSON.stringify(context);
      return context;
    } catch {
      return '[unserializable context]';
    }
  }

  /** `String(value)` that never throws (null-prototype objects, bad toString). */
  function safeString(value: unknown): string {
    try {
      return String(value);
    } catch {
      return '[unstringifiable]';
    }
  }

  function stackOf(value: unknown): string | undefined {
    return value instanceof Error ? value.stack : undefined;
  }

  window.GasWebApp.reporter = {
    install(options: GasWebAppReporterOptions): void {
      const app = window.GasWebApp;

      if (installed) {
        app.logger.warn(REPORTER_SCOPE, 'Reporter is already installed');
        return;
      }
      installed = true;

      const maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS;
      const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
      const inner = app.logger;
      const lastSent = new Map<string, number>();
      let sent = 0;

      function report(
        kind: GasWebAppClientErrorKind,
        scope: string,
        message: string,
        context?: unknown,
        stack?: string,
      ): void {
        if (scope === REPORTER_SCOPE || sent >= maxReports) return;

        const key = `${kind}|${scope}|${message}`;
        const now = Date.now();
        const previous = lastSent.get(key);
        if (previous !== undefined && now - previous < dedupeMs) return;

        lastSent.set(key, now);
        sent += 1;

        const body: GasWebAppClientErrorReport = {
          kind,
          scope,
          message,
          url: location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        };
        const resolvedStack = stack ?? stackOf(context);
        if (resolvedStack !== undefined) body.stack = resolvedStack;
        const safeContext = serializableContext(context);
        if (safeContext !== undefined) body.context = safeContext;

        let pending: Promise<unknown>;
        try {
          pending = app.api.post(options.route, body, {
            retries: 0,
            ack: false,
            scope: REPORTER_SCOPE,
          });
        } catch (err) {
          pending = Promise.reject(err);
        }

        pending.catch((err: unknown) => {
          try {
            inner.debug(REPORTER_SCOPE, 'Report failed', {
              error: err instanceof Error ? err.message : safeString(err),
            });
          } catch {
            // A throwing logger must not surface as an unhandled rejection.
          }
        });
      }

      app.configure({
        logger: {
          debug: (scope, message, context) =>
            inner.debug(scope, message, context),
          info: (scope, message, context) =>
            inner.info(scope, message, context),
          warn: (scope, message, context) =>
            inner.warn(scope, message, context),
          error: (scope, message, context) => {
            inner.error(scope, message, context);
            if (!isServerPayload(context)) {
              report('logged', scope, message, context);
            }
          },
        },
      });

      if (options.captureGlobal) {
        window.addEventListener('error', (event: ErrorEvent) => {
          report(
            'uncaught',
            'window',
            event.message || safeString(event.error),
            undefined,
            stackOf(event.error),
          );
        });

        window.addEventListener(
          'unhandledrejection',
          (event: PromiseRejectionEvent) => {
            const reason: unknown = event.reason;
            report(
              'unhandledrejection',
              'window',
              reason instanceof Error ? reason.message : safeString(reason),
              undefined,
              stackOf(reason),
            );
          },
        );
      }
    },
  };
})();
