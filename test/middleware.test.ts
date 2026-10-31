import { describe, expect, it, vi } from 'vitest';
import { loadGasWebApp } from './harness';

type Factory = (
  config: object,
) => (req: object, res: object, next: () => void) => void;

const response = {};
const request = (): Record<string, unknown> => ({ query: {} });

const lockWith = (...results: boolean[]) => {
  const tryLock = vi.fn<(timeoutMs: number) => boolean>();
  results.forEach((result) => tryLock.mockReturnValueOnce(result));
  tryLock.mockReturnValue(results.at(-1) ?? true);
  return { tryLock, releaseLock: vi.fn() };
};

const concurrency = (lock: ReturnType<typeof lockWith>) => {
  const { lib, mocks } = loadGasWebApp();
  const lockService = { getLock: vi.fn(() => lock) };
  const middleware = (lib.createConcurrencyLimiter as Factory)({
    limit: 5,
    lockScope: 'user',
    keyFn: () => 'k',
    lockService,
  });
  return { middleware, mocks, lockService };
};

describe('createConcurrencyLimiter', () => {
  it('takes its lock from config.lockService (M1)', () => {
    const { middleware, mocks, lockService } = concurrency(lockWith(true));

    const next = vi.fn();
    middleware(request(), response, next);

    expect(lockService.getLock).toHaveBeenCalledWith('user');
    expect(mocks.LockService.getUserLock).not.toHaveBeenCalled();
  });

  it('retries a contended release instead of leaking the slot (M2)', () => {
    const { middleware, mocks } = concurrency(lockWith(true, false, true));

    const next = vi.fn();
    middleware(request(), response, next);

    expect(mocks.cacheStore.get('concurrency:k')).toBe('0');
  });

  it('gives up on a release after a bounded number of attempts (M2)', () => {
    const lock = lockWith(true, false);
    const { middleware } = concurrency(lock);

    const next = vi.fn();
    middleware(request(), response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(lock.tryLock).toHaveBeenCalledTimes(3);
  });

  it('keeps the counter for longer than the execution limit (M2)', () => {
    const { middleware, mocks } = concurrency(lockWith(true));

    const next = vi.fn();
    middleware(request(), response, next);

    const ttls = mocks.CacheService.getScriptCache().put.mock.calls.map(
      ([, , ttl]) => ttl,
    );
    expect(ttls.every((ttl) => ttl === 420)).toBe(true);
  });
});

describe('createAuthMiddleware (M4)', () => {
  const run = (
    options: Parameters<typeof loadGasWebApp>[0],
    isAuthorized: unknown,
  ) => {
    const { lib, mocks } = loadGasWebApp(options);
    const middleware = (lib.createAuthMiddleware as Factory)({ isAuthorized });
    const next = vi.fn();
    const req = request();
    return { mocks, next, req, call: () => middleware(req, response, next) };
  };

  const rejection = (call: () => unknown): Error & { statusCode?: number } => {
    try {
      call();
    } catch (error) {
      return error as Error & { statusCode?: number };
    }
    throw new Error('expected the call to throw');
  };

  it('rejects an empty email without consulting isAuthorized', () => {
    const isAuthorized = vi.fn(() => true);
    const { call } = run({ email: '' }, isAuthorized);

    const error = rejection(call);

    expect(error.message).toBe('Unable to identify the signed-in user');
    expect(error.name).toBe('GasUnauthorizedError');
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it('turns a throwing Session call into a 401', () => {
    const { call, mocks } = run({}, () => true);
    mocks.getEmail.mockImplementation(() => {
      throw new Error('scope declined');
    });

    const error = rejection(call);

    expect(error.name).toBe('GasUnauthorizedError');
    expect(error.message).toBe('Unable to identify the signed-in user');
  });

  it('does not echo the email of an unauthorised user', () => {
    const { call } = run({ email: 'a@b.c' }, () => false);

    const error = rejection(call);

    expect(error.name).toBe('GasUnauthorizedError');
    expect(error.message).toBe('Not authorized');
  });

  it('sets req.user and passes an authorised user downstream', () => {
    const { call, next, req } = run({ email: 'a@b.c' }, () => true);

    call();

    expect(req.user).toEqual({ email: 'a@b.c' });
    expect(next).toHaveBeenCalledOnce();
  });
});

const CALL_ID = '0b9f3c1e-7a42-4d6e-9d52-3f1a6c8e2b10';
const OTHER_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

const thrown = (call: () => unknown): Error & { details?: unknown } => {
  try {
    call();
  } catch (error) {
    return error as Error & { details?: unknown };
  }
  throw new Error('expected the call to throw');
};

describe('createConcurrencyLimiter limits', () => {
  it('defaults lockScope to user (X7)', () => {
    const { lib } = loadGasWebApp();
    const lockService = { getLock: vi.fn(() => lockWith(true)) };
    const middleware = (lib.createConcurrencyLimiter as Factory)({
      limit: 5,
      keyFn: () => 'k',
      lockService,
    });

    middleware(request(), response, vi.fn());

    expect(lockService.getLock).toHaveBeenCalledWith('user');
  });

  it('rejects past the limit, undoing its own increment', () => {
    const { lib, mocks } = loadGasWebApp();
    mocks.cacheStore.set('concurrency:k', '1');
    const middleware = (lib.createConcurrencyLimiter as Factory)({
      limit: 1,
      keyFn: () => 'k',
    });
    const next = vi.fn();

    const error = thrown(() => middleware(request(), response, next));

    expect(error.name).toBe('GasRateLimitError');
    expect(next).not.toHaveBeenCalled();
    expect(mocks.cacheStore.get('concurrency:k')).toBe('1');
  });

  it('fails with a 429 when the lock cannot be taken', () => {
    const { middleware } = concurrency(lockWith(false));

    expect(thrown(() => middleware(request(), response, vi.fn())).name).toBe(
      'GasRateLimitError',
    );
  });

  it('releases the slot when downstream throws', () => {
    const { middleware, mocks } = concurrency(lockWith(true));

    thrown(() =>
      middleware(request(), response, () => {
        throw new Error('downstream');
      }),
    );

    expect(mocks.cacheStore.get('concurrency:k')).toBe('0');
  });
});

describe('createRateLimiter', () => {
  const limiter = (
    config: object = {},
    options: Parameters<typeof loadGasWebApp>[0] = {},
  ) => {
    const { lib, mocks } = loadGasWebApp(options);
    const middleware = (lib.createRateLimiter as Factory)({
      limit: 2,
      windowSeconds: 60,
      keyFn: () => 'k',
      ...config,
    });
    return { middleware, mocks };
  };

  it('lets requests through up to the limit, then rejects with retryAfterSeconds', () => {
    const { middleware } = limiter();
    const next = vi.fn();

    middleware(request(), response, next);
    middleware(request(), response, next);
    const error = thrown(() => middleware(request(), response, next));

    expect(next).toHaveBeenCalledTimes(2);
    expect(error.name).toBe('GasRateLimitError');
    expect(error.message).toBe('Too many requests (2/60s)');
    expect(error.details).toEqual({
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('counts per key and per window in the script cache', () => {
    const { middleware, mocks } = limiter({ keyFn: () => 'user:a' });

    middleware(request(), response, vi.fn());

    const keys = [...mocks.cacheStore.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ratelimit:user:a:\d+$/);
  });

  it('defaults lockScope to user (X7)', () => {
    const { middleware, mocks } = limiter();

    middleware(request(), response, vi.fn());

    expect(mocks.LockService.getUserLock).toHaveBeenCalled();
    expect(mocks.LockService.getScriptLock).not.toHaveBeenCalled();
  });

  it('honours an explicit script scope', () => {
    const { middleware, mocks } = limiter({ lockScope: 'script' });

    middleware(request(), response, vi.fn());

    expect(mocks.LockService.getScriptLock).toHaveBeenCalled();
  });

  it('rejects without counting when the lock is contended', () => {
    const { middleware, mocks } = limiter({}, { contended: ['user'] });
    const next = vi.fn();

    const error = thrown(() => middleware(request(), response, next));

    expect(error.name).toBe('GasRateLimitError');
    expect(next).not.toHaveBeenCalled();
    expect(mocks.cacheStore.size).toBe(0);
  });
});

describe('createAckTracker', () => {
  const tracker = () => {
    const { lib, mocks } = loadGasWebApp();
    const ack = (lib.createAckTracker as Factory)({}) as unknown as {
      middleware: (req: object, res: object, next: () => void) => void;
      handler: (req: object, res: object, next: () => void) => void;
    };
    return { ack, mocks };
  };

  it('records a valid callId and continues', () => {
    const { ack, mocks } = tracker();
    const next = vi.fn();

    ack.middleware({ query: { callId: CALL_ID } }, response, next);

    expect(mocks.cacheStore.get(`ack:${CALL_ID}`)).toBe('1');
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'not-a-uuid', 'ack:../../x'])(
    'ignores callId %j',
    (callId) => {
      const { ack, mocks } = tracker();
      const next = vi.fn();

      ack.middleware({ query: { callId } }, response, next);

      expect(mocks.cacheStore.size).toBe(0);
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it('reports the recorded ids once, then forgets them', () => {
    const { ack, mocks } = tracker();
    ack.middleware({ query: { callId: CALL_ID } }, response, vi.fn());
    const json = vi.fn();
    const query = { callIds: `${CALL_ID},${OTHER_ID},junk` };

    ack.handler({ query }, { json }, vi.fn());
    ack.handler({ query }, { json }, vi.fn());

    expect(json.mock.calls).toEqual([[[CALL_ID]], [[]]]);
    expect(mocks.cacheStore.size).toBe(0);
  });

  it('responds with an empty list without touching the cache', () => {
    const { ack, mocks } = tracker();
    const json = vi.fn();

    ack.handler({ query: {} }, { json }, vi.fn());

    expect(json).toHaveBeenCalledWith([]);
    expect(mocks.CacheService.getScriptCache().getAll).not.toHaveBeenCalled();
  });

  it('looks up at most 25 ids per poll', () => {
    const { ack, mocks } = tracker();
    const ids = Array.from(
      { length: 30 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );

    ack.handler(
      { query: { callIds: ids.join(',') } },
      { json: vi.fn() },
      vi.fn(),
    );

    expect(
      mocks.CacheService.getScriptCache().getAll.mock.calls[0]?.[0],
    ).toHaveLength(25);
  });
});

describe('createLoggingMiddleware', () => {
  type LoggingFactory = (
    logger?: object,
    options?: { redact?: string[] },
  ) => (req: object, res: object, next: () => void) => void;

  const sink = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  const run = (
    options?: { redact?: string[] },
    req: object = {},
    statusCode = 200,
  ) => {
    const { lib } = loadGasWebApp();
    const logger = sink();
    const middleware = (lib.createLoggingMiddleware as LoggingFactory)(
      logger,
      options,
    );
    const res = { statusCode };
    middleware(
      {
        id: 'r1',
        transport: 'http',
        method: 'GET',
        originalPath: '/x',
        query: {},
        ...req,
      },
      res,
      () => {},
    );
    return { logger, res };
  };

  it('logs the request and response lines with the bound request id', () => {
    const { logger } = run({}, { user: { email: 'a@b.c' }, query: { q: '1' } });

    expect(logger.info).toHaveBeenNthCalledWith(1, '-> GET /x', {
      reqId: 'r1',
      transport: 'http',
      user: { email: 'a@b.c' },
      params: { q: '1' },
    });
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^<- GET \/x \(\d+ms\)$/),
      { reqId: 'r1', transport: 'http', status: 200 },
    );
  });

  it('uses logger.child and flushes when the logger has one', () => {
    const { lib } = loadGasWebApp();
    const child = { ...sink(), flush: vi.fn() };
    const logger = { ...sink(), child: vi.fn(() => child) };

    (lib.createLoggingMiddleware as LoggingFactory)(logger)(
      {
        id: 'r1',
        transport: 'rpc',
        method: 'GET',
        originalPath: '/x',
        query: {},
      },
      { statusCode: 200 },
      () => {},
    );

    expect(logger.child).toHaveBeenCalledWith({
      reqId: 'r1',
      transport: 'rpc',
    });
    expect(child.info).toHaveBeenCalledTimes(2);
    expect(child.flush).toHaveBeenCalledOnce();
  });

  it('defaults to console', () => {
    const { lib, mocks } = loadGasWebApp();
    const logger = (lib.createLoggingMiddleware as LoggingFactory)();
    expect(typeof logger).toBe('function');
    expect(mocks.console.info).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'info'],
    [302, 'info'],
    [404, 'warn'],
    [429, 'warn'],
    [500, 'error'],
  ] as const)('logs a %i response at %s', (status, level) => {
    const { logger } = run({}, {}, status);

    const lines = logger[level].mock.calls.map(([m]) => m as string);
    expect(lines.some((line) => line.startsWith('<- GET /x'))).toBe(true);
    expect(logger[level].mock.calls.at(-1)?.[1]).toMatchObject({ status });
  });

  it('redacts sensitive query keys by default, case-insensitively', () => {
    const { logger } = run(undefined, {
      query: { Token: 'a', PASSWORD: 'b', authorization: 'c', page: '2' },
    });

    expect(logger.info.mock.calls[0]?.[1]).toMatchObject({
      params: {
        Token: '[REDACTED]',
        PASSWORD: '[REDACTED]',
        authorization: '[REDACTED]',
        page: '2',
      },
    });
  });

  it('replaces the default list with options.redact', () => {
    const { logger } = run(
      { redact: ['ssn'] },
      { query: { SSN: '1', token: 't' } },
    );

    expect(logger.info.mock.calls[0]?.[1]).toMatchObject({
      params: { SSN: '[REDACTED]', token: 't' },
    });
  });

  it('does not mutate the request and never logs the body', () => {
    const query = { token: 't' };
    const { logger } = run({}, { query, body: { secret: 'x' } });

    expect(query.token).toBe('t');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('"x"');
  });
});
