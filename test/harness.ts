import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { bundle } from 'gas-dev-bundle';
import { createGasLoader, loadOrderFiles } from 'gas-dev-config/test';
import { createMocks, type MockOptions, type Mocks } from './mocks';

/** Loose, test-side view of the globals the library defines. */
export interface GasWebAppGlobals {
  GasWebApp: new (config?: object) => GasWebAppInstance;
  GasWebAppRouter: new () => object;
  createAckTracker: unknown;
  createAuthMiddleware: unknown;
  createConcurrencyLimiter: unknown;
  createLoggingMiddleware: unknown;
  createRateLimiter: unknown;
}

/** Loose, test-side view of a `GasWebApp` instance. */
export interface GasWebAppInstance {
  get(route: string, ...fns: unknown[]): void;
  post(route: string, ...fns: unknown[]): void;
  use(...args: unknown[]): void;
  doGet(e: object): unknown;
  doPost(e: object): unknown;
  render(view: string, options?: object): unknown;
  resolveStaticFilePath(type: 'html' | 'js' | 'css', path: string): string;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PEER_EXPORTS = [
  'GasError',
  'GasValidationError',
  'GasNotFoundError',
  'GasUnauthorizedError',
  'GasForbiddenError',
  'GasConflictError',
  'GasRateLimitError',
  'GasCaptchaRequiredError',
  'GasLock',
  'GasLogger',
];

/**
 * The peer libraries as released, resolved from `gasDevConfig.peers` against
 * their `dist/vX.Y.Z` tags. The first run fetches them; later runs use the
 * `node_modules/.cache` copy.
 */
const peerCode = bundle({
  libraries: gasDevConfigPeers(),
  cwd: ROOT,
}).code;

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

/** Reads `gasDevConfig.peers` from package.json. */
function gasDevConfigPeers(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as {
    gasDevConfig: { peers: Record<string, string> };
  };
  return pkg.gasDevConfig.peers;
}

/**
 * Evaluates the library sources in a fresh context wired to fake Apps Script
 * services, with the real peer libraries loaded ahead of them. Each call is
 * isolated from every other. `Error` is shared with the test realm so thrown
 * errors satisfy `instanceof` checks in assertions.
 */
export function loadGasWebApp(
  options: MockOptions = {},
  globals: Record<string, unknown> = {},
): { lib: GasWebAppGlobals; mocks: Mocks; peers: Record<string, unknown> } {
  const mocks = createMocks(options);
  const services = {
    HtmlService: mocks.HtmlService,
    ContentService: mocks.ContentService,
    CacheService: mocks.CacheService,
    LockService: mocks.LockService,
    Session: mocks.Session,
    Utilities: mocks.Utilities,
    console: mocks.console,
    Error,
  };

  const peers = runInNewContext(
    `${peerCode}\n;({ ${PEER_EXPORTS.join(', ')} })`,
    { ...services },
  ) as Record<string, unknown>;

  const lib = load({ ...services, ...peers, ...globals });

  return { lib, mocks, peers };
}
