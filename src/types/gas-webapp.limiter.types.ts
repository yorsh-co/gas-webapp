type LockScope = 'user' | 'script';

/**
 * Minimal lock-resolver shape the limiters need. GasLock's getLock()
 * satisfies this structurally — pass GasLock straight in, no adapter.
 */
interface GasWebAppLockService {
  getLock(scope: LockScope): GoogleAppsScript.Lock.Lock | null;
}

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  /**
   * Lock guarding the counter. It must cover the scope of the key: a key
   * shared across users needs `'script'`, since a per-user lock does not
   * exclude other users. `'script'` serialises every request through one lock.
   * @default 'user'
   */
  lockScope?: LockScope;
  keyFn: (req: GasWebAppRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}

interface ConcurrencyLimitConfig {
  limit: number;
  /**
   * Lock guarding the counter. It must cover the scope of the key: a key
   * shared across users needs `'script'`, since a per-user lock does not
   * exclude other users. `'script'` serialises every request through one lock.
   * @default 'user'
   */
  lockScope?: LockScope;
  keyFn: (req: GasWebAppRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}
