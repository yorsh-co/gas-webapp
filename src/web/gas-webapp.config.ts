/**
 * Namespace root, logger injection, and transport tunables for the client
 * package.
 *
 * Load this before `gas-webapp.errors` and `gas-webapp.client`. A consuming app
 * calls `configure()` once at boot; until then the client logs to `console` at
 * warn and above, mirroring `errorHandler`'s `logger = console` default on the
 * server, and runs on the defaults below.
 */
window.GasWebApp = window.GasWebApp || ({} as GasWebAppNamespace);

(function () {
  'use strict';

  const noop = (): void => undefined;

  // fallback logger that simulates log-level 'warn'
  const consoleLogger: GasWebAppLogger = {
    debug: noop,
    info: noop,
    warn: (scope, message, context) =>
      console.warn(`[${scope}]`, message, context ?? ''),
    error: (scope, message, context) =>
      console.error(`[${scope}]`, message, context ?? ''),
  };

  const defaults: GasWebAppClientConfig = {
    timeoutMs: 30000,
    getRetries: 2,
    retryBaseMs: 400,
    maxRetryDelayMs: 15000,
    retryableStatuses: [429, 500, 502, 503, 504],
    ackRoute: '/ack',
    ackPollIntervalMs: 2000,
    ackPollTimeoutMs: 5000,
    ackDeadlineMs: 8000,
    ackScope: 'Ack Watcher',
  };

  window.GasWebApp.logger = consoleLogger;
  window.GasWebApp.config = { ...defaults };

  /**
   * Merged in place, so anything already holding a reference to `config` sees
   * the update. Explicit `undefined` is dropped rather than clearing a default.
   */
  window.GasWebApp.configure = (options: GasWebAppOptions): void => {
    const { logger, ...tunables } = options;

    if (logger) window.GasWebApp.logger = logger;

    (Object.keys(tunables) as (keyof GasWebAppClientConfig)[]).forEach(
      (key) => {
        if (tunables[key] === undefined) delete tunables[key];
      },
    );

    Object.assign(window.GasWebApp.config, tunables);
  };
})();
