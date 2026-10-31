import { fileURLToPath } from 'node:url';
import { createGasLoader, loadOrderFiles } from 'gas-dev-config/test';

/** Loose, test-side view of the globals the library defines. */
export interface GasWebAppGlobals {
  GasWebApp: new (config?: object) => object;
  GasWebAppRouter: new () => object;
  createAckTracker: unknown;
  createAuthMiddleware: unknown;
  createConcurrencyLimiter: unknown;
  createLoggingMiddleware: unknown;
  createRateLimiter: unknown;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const load = createGasLoader<GasWebAppGlobals>({
  files: loadOrderFiles(ROOT),
  exports: [
    'GasWebApp',
    'GasWebAppRouter',
    'createAckTracker',
    'createAuthMiddleware',
    'createConcurrencyLimiter',
    'createLoggingMiddleware',
    'createRateLimiter',
  ],
  root: ROOT,
});

/** Evaluates the library sources in a fresh context with the given globals. */
export function loadGasWebApp(
  globals: Record<string, unknown> = {},
): GasWebAppGlobals {
  return load({ console, Error, ...globals });
}
