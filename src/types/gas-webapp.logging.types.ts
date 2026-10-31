interface GasWebAppLoggingConfig {
  /**
   * Query keys whose values are logged as `[REDACTED]`, matched exactly and
   * case-insensitively. Replaces the default list.
   * @default ['token', 'password', 'secret', 'key', 'auth', 'authorization']
   */
  redact?: string[];
}
