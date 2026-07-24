type LockScope = 'user' | 'script';

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  lockScope: LockScope;
  keyFn: (request: RouteRequest) => string;
}

interface ConcurrencyLimitConfig {
  limit: number;
  lockScope: LockScope;
  keyFn: (request: RouteRequest) => string;
}
