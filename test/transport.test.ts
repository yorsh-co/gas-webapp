import { describe, expect, it } from 'vitest';
import { loadGasWebApp, type TestRequest, type TestResponse } from './harness';

const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const OTHER_UUID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** Runs `fn` and returns the parsed error envelope from the thrown message. */
const thrownEnvelope = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (error) {
    return JSON.parse((error as Error).message);
  }
  throw new Error('expected the call to throw');
};

const data = (result: unknown): unknown => (result as { data: unknown }).data;

describe('route resolution (X2)', () => {
  const setup = () => {
    const { lib, mocks } = loadGasWebApp();
    const app = new lib.GasWebApp({ logger: mocks.console });
    const reply = (req: TestRequest, res: TestResponse) =>
      res.json({ path: req.originalPath, method: req.method });

    app.all('/', reply);
    app.all('/from-route', reply);
    app.all('/users/42', reply);
    app.all('/from-path', reply);
    app.all('/echo', reply);
    return app;
  };

  const resolved = (result: unknown) => (data(result) as { path: string }).path;

  it.each([
    [
      'route parameter only',
      { parameter: { route: '/from-route' } },
      '/from-route',
    ],
    [
      'route without a leading slash',
      { parameter: { route: 'from-route' } },
      '/from-route',
    ],
    ['pathInfo only', { parameter: {}, pathInfo: 'users/42' }, '/users/42'],
    [
      'route and pathInfo: route wins',
      { parameter: { route: '/from-route' }, pathInfo: 'from-path' },
      '/from-route',
    ],
    ['empty pathInfo', { parameter: {}, pathInfo: '' }, '/'],
    ['neither', { parameter: {} }, '/'],
  ])('doGet: %s', (_name, event, expected) => {
    expect(resolved(setup().doGet(event))).toBe(expected);
  });

  it.each([
    ['route parameter', { parameter: { route: '/from-route' } }, '/from-route'],
    ['neither', { parameter: {} }, '/'],
    ['pathInfo but no route', { parameter: {}, pathInfo: 'echo' }, '/echo'],
    [
      'route and pathInfo: route wins',
      { parameter: { route: '/from-route' }, pathInfo: 'from-path' },
      '/from-route',
    ],
    [
      'empty route falls back to pathInfo',
      { parameter: { route: '' }, pathInfo: 'echo' },
      '/echo',
    ],
    ['empty pathInfo', { parameter: {}, pathInfo: '' }, '/'],
  ])('doPost: %s', (_name, event, expected) => {
    expect(resolved(setup().doPost(event))).toBe(expected);
  });
});

describe('createIdempotencyGuard (C4)', () => {
  type Guard = (config?: object) => (...args: unknown[]) => void;

  const setup = (guardConfig: object = {}, options = {}) => {
    const { lib, mocks } = loadGasWebApp(options);
    const app = new lib.GasWebApp({ logger: mocks.console });
    const runs = { count: 0 };
    let behaviour: (req: TestRequest, res: TestResponse) => void = (_r, res) =>
      res.status(201).json({ n: runs.count });

    app.use((req: TestRequest, _res: TestResponse, next: () => void) => {
      const as = req.query.as;
      if (as) req.user = { email: as };
      next();
    });
    app.use((lib.createIdempotencyGuard as Guard)(guardConfig));
    app.post('/work', (req: TestRequest, res: TestResponse) => {
      runs.count += 1;
      behaviour(req, res);
    });

    const call = (key?: string, as?: string) =>
      app.doPost({
        parameter: {
          route: '/work',
          ...(key ? { idempotencyKey: key } : {}),
          ...(as ? { as } : {}),
        },
      });

    return {
      call,
      runs,
      mocks,
      app,
      onRun: (fn: typeof behaviour) => (behaviour = fn),
    };
  };

  it('passes a request without a key straight through', () => {
    const { call, runs, mocks } = setup();

    call();
    call();

    expect(runs.count).toBe(2);
    expect(mocks.cacheStore.size).toBe(0);
  });

  it('runs the first call and stores its envelope', () => {
    const { call, runs, mocks } = setup();

    expect(call(UUID)).toEqual({ ok: true, status: 201, data: { n: 1 } });

    expect(runs.count).toBe(1);
    expect(JSON.parse(mocks.cacheStore.get(`idem:${UUID}`) as string)).toEqual({
      ok: true,
      status: 201,
      data: { n: 1 },
    });
  });

  it('replays the stored envelope without running the handler again', () => {
    const { call, runs } = setup();

    const first = call(UUID);
    const second = call(UUID);

    expect(runs.count).toBe(1);
    expect(second).toEqual(first);
  });

  it('runs a different key independently', () => {
    const { call, runs } = setup();

    call(UUID);
    call(OTHER_UUID);

    expect(runs.count).toBe(2);
  });

  it('answers 409 while the same key is in flight', () => {
    const { call, onRun, runs } = setup();
    let inner: Record<string, unknown> | undefined;
    onRun((_req, res) => {
      inner = thrownEnvelope(() => call(UUID));
      res.json('done');
    });

    call(UUID);

    expect(inner).toMatchObject({
      status: 409,
      error: 'Request with this idempotency key is in progress',
    });
    expect(runs.count).toBe(1);
  });

  it('clears the marker when the handler fails, so a retry runs', () => {
    const { call, onRun, runs, mocks } = setup();
    onRun(() => {
      throw new Error('boom');
    });

    expect(thrownEnvelope(() => call(UUID)).status).toBe(500);
    expect(mocks.cacheStore.has(`idem:${UUID}`)).toBe(false);

    onRun((_req, res) => res.json('ok'));
    expect(data(call(UUID))).toBe('ok');
    expect(runs.count).toBe(2);
  });

  it('clears the marker when the response is an error status', () => {
    const { call, onRun, mocks } = setup();
    onRun((_req, res) => res.status(422).json({ message: 'bad' }));

    expect(thrownEnvelope(() => call(UUID)).status).toBe(422);
    expect(mocks.cacheStore.has(`idem:${UUID}`)).toBe(false);
  });

  it('clears the marker when the outcome cannot be replayed', () => {
    const { call, onRun, mocks } = setup({}, { views: { page: '<p>x</p>' } });
    onRun((_req, res) => res.render('page'));

    // RPC render is refused, so this is an error outcome too.
    expect(() => call(UUID)).toThrow();
    expect(mocks.cacheStore.has(`idem:${UUID}`)).toBe(false);
  });

  it.each(['not-a-uuid', 'x'.repeat(200), '../etc'])(
    'rejects the invalid key %s with 400',
    (key) => {
      const { call, runs } = setup();

      expect(thrownEnvelope(() => call(key)).status).toBe(400);
      expect(runs.count).toBe(0);
    },
  );

  it('keys the cache per user when the request has one', () => {
    const { call, runs, mocks } = setup();

    call(UUID, 'a@example.com');
    call(UUID, 'b@example.com');
    call(UUID, 'a@example.com');

    expect(runs.count).toBe(2);
    expect([...mocks.cacheStore.keys()].sort()).toEqual([
      `idem:a@example.com:${UUID}`,
      `idem:b@example.com:${UUID}`,
    ]);
  });

  it('stores the envelope for the configured ttl and a short pending marker', () => {
    const { call, mocks } = setup({ ttlSeconds: 600 });

    call(UUID);

    const ttls = mocks.CacheService.getScriptCache().put.mock.calls.map(
      ([, value, ttl]) => [value === 'pending', ttl],
    );
    expect(ttls).toEqual([
      [true, 420],
      [false, 600],
    ]);
  });

  it('takes its lock from config.lockService and defaults to the user scope', () => {
    const { mocks } = setup();
    const { call } = setup({
      lockService: {
        getLock: (scope: string) => {
          expect(scope).toBe('user');
          return { tryLock: () => true, releaseLock: () => undefined };
        },
      },
    });

    call(UUID);
    expect(mocks.LockService.getUserLock).not.toHaveBeenCalled();
  });

  it('answers 409 when the lock cannot be acquired', () => {
    const { call, runs } = setup({
      lockService: {
        getLock: () => ({ tryLock: () => false, releaseLock: () => undefined }),
      },
    });

    expect(thrownEnvelope(() => call(UUID)).status).toBe(409);
    expect(runs.count).toBe(0);
  });
});
