/** Maximum lengths, in characters, applied to a client error report. */
interface GasWebAppClientErrorLimits {
  /** @default 1000 */
  message?: number;
  /** @default 4000 */
  stack?: number;
  /** @default 100 */
  scope?: number;
  /** @default 500 */
  url?: number;
  /** @default 300 */
  userAgent?: number;
  /** Cap on the JSON-serialized `context`; over it, a marker replaces it. @default 2000 */
  context?: number;
}

/** Options for `createClientErrorHandler`. */
interface GasWebAppClientErrorConfig {
  /** Overrides for the field caps; unset fields keep their defaults. */
  limits?: GasWebAppClientErrorLimits;
}
