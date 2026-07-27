/**
 * Wire contract shared by the router and its client.
 *
 * Published to BOTH release branches — `dist` for the backend subtree and
 * `dist-web` for the frontend subtree — so the two halves cannot drift.
 * Nothing app-specific belongs here.
 */
/** Success envelope produced by `GasWebApp.json()`. */
interface SuccessPayload<T = unknown> {
  ok: true;
  status: number;
  data: T;
}
/**
 * Error envelope serialized by `gas-error`'s `errorHandler`. Mirrored here
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
 * to tell a real HTTP request from a `google.script.run` call.
 */
interface SimulatedEvent {
  parameter: Record<string, string>;
  postData?: {
    contents: string;
    type: string;
  };
}
