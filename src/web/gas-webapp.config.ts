/**
 * Namespace root and logger injection for the client package.
 *
 * Load this before `gas-webapp.errors` and `gas-webapp.client`. A consuming app
 * calls `configure()` once at boot; until then the client logs to `console` at
 * warn and above, mirroring `errorHandler`'s `logger = console` default on the
 * server.
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

  window.GasWebApp.logger = consoleLogger;

  window.GasWebApp.configure = (options: GasWebAppOptions): void => {
    if (options.logger) window.GasWebApp.logger = options.logger;
  };
})();
