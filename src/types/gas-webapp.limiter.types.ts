type LockScope = 'user' | 'script';

/**
 * Minimal lock-resolver shape the limiters need. GasLock's getLock()
 * satisfies this structurally — pass GasLock straight in, no adapter.
 * Declared as an interface rather than an ambient `GasLock` global on
 * purpose: a `declare const GasLock` here would collide with gas-lock's
 * own declaration (TS2451) in any project that vendors both.
 */
interface GasWebAppLockService {
  getLock(scope: LockScope): GoogleAppsScript.Lock.Lock | null;
}

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  lockScope: LockScope;
  keyFn: (request: RouteRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}

interface ConcurrencyLimitConfig {
  limit: number;
  lockScope: LockScope;
  keyFn: (request: RouteRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}
