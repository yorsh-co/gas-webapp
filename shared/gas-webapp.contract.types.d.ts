/**
 * Wire contract shared by the router and its client.
 *
 * Published to BOTH release branches — `dist` for the backend subtree and
 * `dist-web` for the frontend subtree — so the two halves cannot drift.
 * Nothing app-specific belongs here.
 */
/** Success envelope produced by `GasWebAppResponse.json()`. */
interface SuccessPayload<T = unknown> {
  ok: true;
  status: number;
  data: T;
}
/**
 * Error envelope serialized by `gas-error`'s `GasError.handle`, and sent by
 * `GasWebAppResponse.json()` for a status of 400 or more. Mirrored here
 * because gas-webapp is what puts it on the wire; gas-error remains its owner.
 */
interface GasErrorPayload {
  ok: false;
  error: string;
  status: number;
  code: string;
  details?: unknown;
}
/**
 * The subset of `Events.DoGet`/`DoPost` the router reads, as synthesized by the
 * client. `contextPath` is deliberately absent — the router uses its presence
 * to tell a real HTTP request from a `google.script.run` call (advisory only:
 * a caller can forge it).
 */
interface SimulatedEvent {
  parameter: Record<string, string>;
  postData?: {
    contents: string;
    type: string;
  };
}
/** How a client error report originated. */
type GasWebAppClientErrorKind = 'logged' | 'uncaught' | 'unhandledrejection';
/**
 * Body the browser reporter posts to the client-error route, and that
 * `createClientErrorHandler` accepts. The server treats every field as
 * untrusted: unknown keys are dropped and strings are truncated.
 */
interface GasWebAppClientErrorReport {
  /** `logged` for a `logger.error` call, otherwise the global event type. */
  kind: GasWebAppClientErrorKind;
  /**
   * Logical source of the error, e.g. the logger scope. The server falls back
   * to 'Client' when it is missing or empty.
   */
  scope: string;
  /** Human-readable error message. */
  message: string;
  /** Stack trace, when one is available. */
  stack?: string;
  /** JSON-serializable extra data attached to the error. */
  context?: unknown;
  /** Page URL at the time of the error. */
  url?: string;
  /** Browser user agent string. */
  userAgent?: string;
  /** Client-side ISO 8601 timestamp of the error. */
  timestamp?: string;
}
