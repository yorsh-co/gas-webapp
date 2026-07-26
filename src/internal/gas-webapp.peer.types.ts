/**
 * Ambient declarations for peer subtree packages this project expects as
 * globals at runtime but doesn't vendor or redeclare in full: gas-error
 * (GasError + subclasses, errorHandler) and gas-logger (GasLogger).
 *
 * Only the surface gas-webapp actually calls is declared — enough for
 * `tsc --noEmit` to typecheck this package standalone. The real
 * implementations are supplied by the sibling subtree packages at
 * runtime; this file has no `.js` output counterpart and should not be
 * copied into dist/ or the published package.
 */

declare class GasError extends Error {
  constructor(message: string);
}

declare class NotFoundError extends GasError {}
declare class ForbiddenError extends GasError {}
declare class ValidationError extends GasError {
  constructor(message: string, details?: string);
}
declare class UnauthorizedError extends GasError {}
declare class RateLimitError extends GasError {
  constructor(message: string, retryAfterSeconds?: number);
}

interface ErrorHandlerContext {
  logger: GasLogger | typeof console;
  method: string;
  path: string;
  session: string;
}

declare function errorHandler(
  err: Error,
  context: ErrorHandlerContext,
): AppResponse;

interface GasLoggerChildLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  flush(): void;
}

declare class GasLogger {
  child(bindings: Record<string, unknown>): GasLoggerChildLogger;
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  flush(): void;
}
