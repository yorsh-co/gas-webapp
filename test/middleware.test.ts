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
