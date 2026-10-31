import { describe, expect, it, vi } from 'vitest';
import {
  loadGasWebApp,
  type GasWebAppInstance,
  type TestRequest,
  type TestResponse,
} from './harness';

/**
 * magb.kpis's `src/app.ts` rewritten against the Express-style API, with its
 * middleware wired from the library factories. The assertions are what the
 * comments in the original describe.
 */

type Factory = (config: object) => unknown;

const CALL_ID = '0b9f3c1e-7a42-4d6e-9d52-3f1a6c8e2b10';

const setup = () => {
  const { lib, mocks } = loadGasWebApp({
    views: { 'dist/web/views/pages/home.html': '<p>home</p>' },
  });
  const make = (name: keyof typeof lib, config: object = {}) =>
    (lib[name] as Factory)(config);

  const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const webappLogger = log();
  const quietWebappLogger = log();

  const ackTracker = make('createAckTracker') as {
    middleware: unknown;
    handler: unknown;
  };
  const rate = (
    limit: number,
    lockScope: 'user' | 'script',
    keyFn: (req: TestRequest) => string,
  ) =>
    make('createRateLimiter', { limit, windowSeconds: 60, lockScope, keyFn });
  const email = (req: TestRequest) => req.user?.email;

  const withAuth = make('createAuthMiddleware', { isAuthorized: () => true });
  const withLog = make('createLoggingMiddleware', webappLogger);
  const withQuietLog = make('createLoggingMiddleware', quietWebappLogger);
  const withSessionRateLimit = rate(
    20,
    'user',
    (req) => `session:${email(req)}`,
  );
  const withSessionRouteRateLimit = rate(
    10,
    'user',
    (req) => `session:${email(req)}:${req.method}:${req.originalPath}`,
  );
  const withGlobalRouteRateLimit = rate(
    100,
    'script',
    (req) => `route:${req.method}:${req.originalPath}`,
  );
  const withUserConcurrencyLimiter = make('createConcurrencyLimiter', {
    limit: 20,
    lockScope: 'user',
    keyFn: (req: TestRequest) => `user:${email(req)}`,
  });
  const withAckRateLimit = rate(
    120,
    'user',
    (req) => `ack:${email(req) ?? 'anonymous'}`,
  );
  const withReportsStatusRateLimit = rate(
    120,
    'user',
    (req) => `reports-status:${email(req)}`,
  );

  const apiRouter = new lib.GasWebAppRouter();
  apiRouter.get('/healthcheck', (_req: TestRequest, res: TestResponse) =>
    res.json({ healthy: true }),
  );
  apiRouter.get('/reports/:id', (req: TestRequest, res: TestResponse) =>
    res.json({ id: req.params.id, user: req.user }),
  );

  const webRouter = new lib.GasWebAppRouter();
  webRouter.get('/', (_req: TestRequest, res: TestResponse) =>
    res.render('pages/home', { layout: null }),
  );

  const app = new lib.GasWebApp({ logger: mocks.console });

  // /ack is registered before the middleware below, so none of it applies.
  app.get('/ack', withQuietLog, withAckRateLimit, ackTracker.handler);
  app.use(ackTracker.middleware);
  app.use(withAuth);
  app.get(
    '/reports/status',
    withQuietLog,
    withReportsStatusRateLimit,
    (_req: TestRequest, res: TestResponse) => res.json({ progress: 1 }),
  );
  app.use(
    '/',
    withLog,
    withGlobalRouteRateLimit,
    withSessionRateLimit,
    withSessionRouteRateLimit,
    withUserConcurrencyLimiter,
  );
  app.use('/api/v1', apiRouter);
  app.use('/', webRouter);

  const keys = () => [...mocks.cacheStore.keys()];
  const messages = (logger: ReturnType<typeof log>) =>
    logger.info.mock.calls.map(([message]) => message as string);

  return { app, mocks, webappLogger, quietWebappLogger, keys, messages };
};

const http = (route: string, parameter: object = {}) => ({
  parameter: { route, ...parameter },
  contextPath: '',
});

const json = (output: unknown): Record<string, unknown> =>
  JSON.parse((output as { getContent(): string }).getContent());

const get = (app: GasWebAppInstance, route: string, parameter?: object) =>
  json(app.doGet(http(route, parameter)));

describe('magb.kpis app.ts on the new API', () => {
  it('keeps /ack out of the limiters and logging registered after it', () => {
    const { app, keys, messages, webappLogger, quietWebappLogger } = setup();

    const result = get(app, '/ack', { callIds: CALL_ID });

    expect(result).toMatchObject({ ok: true, data: [] });
    expect(messages(webappLogger)).toEqual([]);
    expect(messages(quietWebappLogger)).toEqual([
      '-> GET /ack',
      expect.stringMatching(/^<- GET \/ack/),
    ]);
    expect(keys().filter((key) => key.startsWith('ratelimit:'))).toEqual([
      expect.stringMatching(/^ratelimit:ack:anonymous:/),
    ]);
    expect(keys().some((key) => key.startsWith('concurrency:'))).toBe(false);
  });

  it('acknowledges an API request, which /ack then reports once', () => {
    const { app } = setup();

    get(app, '/api/v1/healthcheck', { callId: CALL_ID });

    expect(get(app, '/ack', { callIds: CALL_ID }).data).toEqual([CALL_ID]);
    expect(get(app, '/ack', { callIds: CALL_ID }).data).toEqual([]);
  });

  it('applies auth, logging and the limiters to API routes exactly once', () => {
    const { app, keys, messages, webappLogger, quietWebappLogger } = setup();

    const result = get(app, '/api/v1/reports/42');

    expect(result).toMatchObject({
      ok: true,
      data: { id: '42', user: { email: 'user@example.com' } },
    });
    expect(messages(webappLogger)).toEqual([
      '-> GET /api/v1/reports/42',
      expect.stringMatching(/^<- GET \/api\/v1\/reports\/42/),
    ]);
    expect(messages(quietWebappLogger)).toEqual([]);
    expect(
      keys().filter((key) => key.startsWith('ratelimit:route:GET:')),
    ).toHaveLength(1);
  });

  it('applies the "/" middleware to web routes', () => {
    const { app, keys, messages, webappLogger } = setup();

    const output = app.doGet(http('/')) as { getContent(): string };

    expect(output.getContent()).toBe('<p>home</p>');
    expect(messages(webappLogger)[0]).toBe('-> GET /');
    expect(keys().some((key) => key.startsWith('ratelimit:session:'))).toBe(
      true,
    );
  });

  it('serves /reports/status with auth, its own limiter and quiet logging', () => {
    const { app, keys, messages, webappLogger, quietWebappLogger } = setup();

    const result = get(app, '/reports/status');

    expect(result).toMatchObject({ ok: true, data: { progress: 1 } });
    expect(messages(webappLogger)).toEqual([]);
    expect(messages(quietWebappLogger)).toHaveLength(2);
    expect(keys()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^ratelimit:reports-status:user@example\.com:/),
      ]),
    );
    expect(keys().some((key) => key.startsWith('ratelimit:session:'))).toBe(
      false,
    );
  });

  it('releases the concurrency slot after each request', () => {
    const { app, mocks } = setup();

    get(app, '/api/v1/healthcheck');

    expect(mocks.cacheStore.get('concurrency:user:user@example.com')).toBe('0');
  });

  it('logs an unmatched request through the "/" middleware', () => {
    const { app, messages, webappLogger } = setup();

    expect(get(app, '/nowhere')).toMatchObject({ ok: false, status: 404 });
    expect(messages(webappLogger)[0]).toBe('-> GET /nowhere');
    expect(webappLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^<- GET \/nowhere/),
      expect.objectContaining({ status: 404 }),
    );
  });
});
