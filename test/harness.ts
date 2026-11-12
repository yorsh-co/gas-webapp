import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { bundle } from 'gasdev/bundle';
import { createGasLoader, loadOrderFiles } from 'gasdev/test';
import { createMocks, type MockOptions, type Mocks } from './mocks';

/** Loose, test-side view of the globals the library defines. */
export interface GasWebAppGlobals {
  GasWebApp: new (config?: object) => GasWebAppInstance;
  GasWebAppRouter: new () => GasWebAppRouterInstance;
  createAckTracker: unknown;
  createAuthMiddleware: unknown;
  createConcurrencyLimiter: unknown;
  createIdempotencyGuard: unknown;
  createClientErrorHandler: unknown;
  createLoggingMiddleware: unknown;
  createRateLimiter: unknown;
}

/** Loose, test-side view of a `GasWebAppRouter` instance. */
export interface GasWebAppRouterInstance {
  use(...args: unknown[]): this;
  get(path: string, ...fns: unknown[]): this;
  post(path: string, ...fns: unknown[]): this;
  put(path: string, ...fns: unknown[]): this;
  patch(path: string, ...fns: unknown[]): this;
  delete(path: string, ...fns: unknown[]): this;
  all(path: string, ...fns: unknown[]): this;
}

/** Loose, test-side view of a `GasWebApp` instance. */
export interface GasWebAppInstance extends GasWebAppRouterInstance {
  doGet(e: object): unknown;
  doPost(e: object): unknown;
  locals: Record<string, unknown>;
  resolveStaticFilePath(type: 'html' | 'js' | 'css', path: string): string;
}

/** Loose, test-side view of the request handed to handlers. */
export interface TestRequest {
  method: string;
  path: string;
  originalPath: string;
  baseUrl: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  id: string;
  transport: 'http' | 'rpc';
  user?: { email: string };
  [key: string]: unknown;
}

/** Loose, test-side view of the response handed to handlers. */
export interface TestResponse {
  statusCode: number;
  sent: boolean;
  locals: Record<string, unknown>;
  status(code: number): TestResponse;
  json(data: unknown): void;
  send(body: unknown): void;
  render(view: string, options?: object): void;
  redirect(statusOrUrl: number | string, url?: string): void;
}

export type TestNext = (err?: unknown) => void;

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
 * The peer libraries as released, resolved from `gasdev.peers` against
 * their `dist/vX.Y.Z` tags. The first run fetches them; later runs use the
 * `node_modules/.cache` copy.
 */
const peerCode = bundle({
  libraries: gasdevPeers(),
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
    'createIdempotencyGuard',
    'createClientErrorHandler',
    'createLoggingMiddleware',
    'createRateLimiter',
  ],
  root: ROOT,
});

/** Reads `gasdev.peers` from package.json. */
function gasdevPeers(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as {
    gasdev: { peers: Record<string, string> };
  };
  return pkg.gasdev.peers;
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
