interface GasWebAppAckConfig {
  /** How long an acknowledgement stays readable, in seconds. @default 60 */
  ttlSeconds?: number;
}

interface GasWebAppAckTracker {
  /** Records the caller's `callId`. Register first, before auth and limiters. */
  middleware: Middleware;
  /** Handler for the ack route. Returns the `callId`s that arrived. */
  handler: Handler<string[]>;
}
