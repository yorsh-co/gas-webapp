/**
 * Ambient declarations for gas-lock, consumed as a peer subtree package.
 *
 * gas-lock is expected as a runtime global (Apps Script has no module
 * system); this file declares its public surface so a consuming package can
 * typecheck standalone via `tsc --noEmit` without vendoring the source.
 *
 * Canonical copy: gas-lock/peer/gas-lock.peer.types.d.ts. Do not edit
 * downstream copies — update the canonical file and re-copy, so every peer
 * stays in step with the published surface.
 *
 * Being a `.d.ts`, this file is type-only: it matches a consumer's
 * `include: ["src/**\/*.ts"]` but emits nothing, so no counterpart reaches
 * dist/ or the published package.
 *
 * Usage: copy into the consuming package as `src/internal/`.
 *
 * @see https://github.com/yorsh-co/gas-lock
 * @version 1.1.0
 */

/** Which LockService lock a `withLock` call acquires. */
type GasLockScope = 'script' | 'document' | 'user';

interface GasLockOptions {
  /** @default 30000 */
  timeoutMs?: number;
}

interface GasLockNamespace {
  /**
   * Run `callback` holding `scope`. If `scope` is already held higher up
   * the current execution's call stack, reuses it instead of re-acquiring —
   * GAS's locks are owned per execution, so a naive nested acquire succeeds
   * and its release would end the outer critical section early.
   *
   * Throws if the owning call finds its lock already released when the
   * callback returns (code outside GasLock called `releaseLock()`); a
   * callback error takes precedence.
   */
  withLock<T>(
    scope: GasLockScope,
    callback: () => T,
    options?: GasLockOptions,
  ): T;
  /**
   * Whether `scope` is currently held anywhere in this execution — by
   * `withLock` or by a `getLock` handle that acquired it.
   */
  isHeld(scope: GasLockScope): boolean;
  /**
   * Tracked Lock handle for a scope, for callers needing tryLock-style
   * non-blocking semantics. It shares withLock's held-scope registry:
   * acquiring a held scope joins it, and only a handle that really acquired
   * the lock releases it. The caller still owns tryLock/waitLock/releaseLock;
   * not releasing an owning handle holds the scope for the rest of the
   * execution. Returns `null` when LockService provides no lock.
   */
  getLock(scope: GasLockScope): GoogleAppsScript.Lock.Lock | null;
}

/**
 * Reentrancy-safe wrapper around Apps Script's LockService: one shared,
 * execution-wide registry of held scopes, so a nested `withLock()` or
 * `getLock()` handle for a held scope joins it instead of re-acquiring and
 * later releasing it.
 */
declare const GasLock: GasLockNamespace;
