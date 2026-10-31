interface GasWebAppIdempotencyConfig {
  /**
   * How long a completed response stays replayable, in seconds. CacheService
   * caps this at 21600 (6 hours). @default 21600
   */
  ttlSeconds?: number;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
  /**
   * Lock held while the key is checked and marked. The key is per user when
   * the request has `req.user`, so `'user'` is enough; use `'script'` for
   * anonymous requests that share keys. @default 'user'
   */
  lockScope?: LockScope;
}
