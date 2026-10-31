import { describe, expect, it } from 'vitest';
import { loadGasWebApp } from './harness';

describe('load', () => {
  it('defines the router, the app class and the middleware factories', () => {
    const { lib } = loadGasWebApp();

    expect(lib.GasWebApp).toBeTypeOf('function');
    expect(lib.GasWebAppRouter).toBeTypeOf('function');
    expect(lib.createAckTracker).toBeTypeOf('function');
    expect(lib.createAuthMiddleware).toBeTypeOf('function');
    expect(lib.createConcurrencyLimiter).toBeTypeOf('function');
    expect(lib.createLoggingMiddleware).toBeTypeOf('function');
    expect(lib.createRateLimiter).toBeTypeOf('function');
  });

  it('loads the real peer libraries', () => {
    const { peers } = loadGasWebApp();

    expect(peers.GasError).toBeTypeOf('function');
    expect(peers.GasNotFoundError).toBeTypeOf('function');
    expect(peers.GasLock).toBeTypeOf('object');
    expect(peers.GasLogger).toBeTypeOf('function');
  });
});
