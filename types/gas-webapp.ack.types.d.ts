interface GasWebAppAckConfig {
  /** How long an acknowledgement stays readable, in seconds. @default 60 */
  ttlSeconds?: number;
}
interface GasWebAppAckTracker {
  /** Records the caller's `callId`. Register first, before auth and limiters. */
  middleware: GasWebAppHandler;
  /** Handler for the ack route. Responds with the `callId`s that arrived. */
  handler: GasWebAppHandler;
}
